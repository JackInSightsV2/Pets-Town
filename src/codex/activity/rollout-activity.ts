import type { ActivityEntry } from '../../shared/contract.js';
import { ActivityNormalizer } from './normalizer.js';

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && v.trim() === v;
interface Candidate { threadId: string; turnId: string; itemId: string; status: 'completed' | 'failed'; history: boolean }

/**
 * Per-file staging for a rollout refresh. Only fixed structural fields are
 * retained; the caller discards a batch if its file is quarantined and commits
 * it only after the session identity and scope have been validated.
 */
export class RolloutActivityBatch {
  private readonly candidates: Candidate[] = [];
  private failed = false;
  constructor(private readonly limit = 10_000, private readonly budget?: { count: number; limit: number }) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid activity batch limit.');
  }
  add(threadId: string | undefined, event: unknown, history: boolean): void {
    if (this.failed || !id(threadId) || !object(event) || event.type !== 'event_msg' || !object(event.payload)) return;
    const p = event.payload;
    if (p.type !== 'item_completed' || p.thread_id !== threadId || !id(p.turn_id) || !object(p.item)
      || p.item.type !== 'CommandExecution' || !id(p.item.id) || (p.item.status !== 'completed' && p.item.status !== 'failed')) return;
    if (this.candidates.length >= this.limit || (this.budget && this.budget.count >= this.budget.limit)) { this.failed = true; this.candidates.length = 0; return; }
    if (this.budget) this.budget.count++;
    this.candidates.push({ threadId, turnId: p.turn_id, itemId: p.item.id, status: p.item.status, history });
  }
  /** Internal-only projection; do not expose or log it. */
  take(): readonly Candidate[] {
    if (this.failed) throw new Error('Activity batch capacity exceeded.');
    return this.candidates.splice(0);
  }
}

/** Long-lived across polls and reader reconnects. Output contains no source item ID. */
export class RolloutActivityNormalizer {
  private readonly normalizer = new ActivityNormalizer();
  private failed = false;
  constructor(private readonly sourceNamespace: string, private readonly now: () => string = () => new Date().toISOString()) {}

  commit(batch: RolloutActivityBatch, threadId: string, agentId: string): ActivityEntry[] {
    if (this.failed) throw new Error('Activity normalization unavailable.');
    const output: ActivityEntry[] = [];
    try {
      for (const c of batch.take()) {
        if (c.threadId !== threadId) throw new Error('Activity session mismatch.');
        const result = this.normalizer.observe({ source: 'codex', sourceNamespace: this.sourceNamespace, threadId, turnId: c.turnId, agentId,
          observedAt: this.now(), delivery: c.history ? 'history' : 'live', event: { type: 'event_msg', payload: {
            type: 'item_completed', thread_id: threadId, turn_id: c.turnId, item: { type: 'CommandExecution', id: c.itemId, status: c.status },
          } } });
        if (result.kind === 'unavailable') throw new Error('Activity correlation unavailable.');
        if (result.kind === 'observed') output.push(result.activity);
      }
      return output;
    } catch { this.failed = true; throw new Error('Activity normalization unavailable.'); }
  }
}
