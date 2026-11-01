import { createHash } from 'node:crypto';
import type { ActivityEntry } from '../../shared/contract.js';

type Source = 'codex' | 'fixture';
type Delivery = 'history' | 'live';
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && v.trim() === v;
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const digest = (values: string[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');

/** Reader-supplied context. Raw identities are used only to derive an opaque key. */
export interface ActivityObservation {
  source: Source;
  sourceNamespace: string;
  threadId: string;
  turnId: string;
  /** Existing public agent identity, selected and scoped by the reader. */
  agentId: string;
  observedAt: string;
  delivery: Delivery;
  /** Raw app-server notification or rollout record; never retained. */
  event: unknown;
}
export interface ActivityCheckpoint { version: 1; records: { key: string; agent: string }[] }
export type ActivityResult =
  | { kind: 'observed'; activity: ActivityEntry }
  | { kind: 'ignored'; reason: 'unsupported' | 'duplicate' | 'history' }
  | { kind: 'unavailable'; reason: 'invalid-context' | 'missing-correlation' | 'conflicting-source' | 'capacity-exceeded' };

/**
 * Normalizes completed command execution items only. The caller must verify the
 * supplies trusted thread/turn context and seeds historical records before live delivery.
 * Keep this instance or its checkpoint across reconnects; never evict keys.
 */
export class ActivityNormalizer {
  private readonly records = new Map<string, string>();
  private readonly maxRecords: number;

  constructor(options: { maxRecords?: number; checkpoint?: unknown } = {}) {
    this.maxRecords = options.maxRecords ?? 10_000;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) throw new Error('Invalid activity capacity.');
    if (options.checkpoint === undefined) return;
    const cp = options.checkpoint;
    if (!object(cp) || cp.version !== 1 || !Array.isArray(cp.records) || cp.records.length > this.maxRecords) throw new Error('Invalid activity checkpoint.');
    for (const row of cp.records) {
      if (!object(row) || typeof row.key !== 'string' || !/^[a-f0-9]{64}$/.test(row.key) || typeof row.agent !== 'string' || !/^[a-f0-9]{64}$/.test(row.agent)) throw new Error('Invalid activity checkpoint record.');
      const previous = this.records.get(row.key);
      if (previous && previous !== row.agent) throw new Error('Conflicting activity checkpoint.');
      this.records.set(row.key, row.agent);
    }
  }

  checkpoint(): ActivityCheckpoint {
    return { version: 1, records: [...this.records].map(([key, agent]) => ({ key, agent })) };
  }

  observe(input: ActivityObservation): ActivityResult {
    if ((input.source !== 'codex' && input.source !== 'fixture') || !identity(input.sourceNamespace) || !identity(input.threadId) || !identity(input.turnId) || !identity(input.agentId) || !timestamp(input.observedAt) || (input.delivery !== 'history' && input.delivery !== 'live')) return { kind: 'unavailable', reason: 'invalid-context' };
    const event = input.event;
    let item: unknown;
    if (object(event) && event.method === 'item/completed' && object(event.params) && event.params.threadId === input.threadId && event.params.turnId === input.turnId && object(event.params.item) && event.params.item.type === 'commandExecution') item = event.params.item;
    else if (object(event) && event.type === 'event_msg' && object(event.payload) && event.payload.type === 'item_completed' && event.payload.turn_id === input.turnId && object(event.payload.item) && event.payload.item.type === 'CommandExecution') item = event.payload.item;
    if (!object(item) || (item.type !== 'commandExecution' && item.type !== 'CommandExecution')) return { kind: 'ignored', reason: 'unsupported' };
    if (item.status !== 'completed' && item.status !== 'failed') return { kind: 'ignored', reason: 'unsupported' };
    if (!identity(item.id)) return { kind: 'unavailable', reason: 'missing-correlation' };
    const key = digest(['activity-v1', input.source, input.sourceNamespace, input.threadId, input.turnId, item.id]);
    const agent = digest(['agent-v1', input.agentId]);
    const previous = this.records.get(key);
    if (previous) return previous === agent ? { kind: 'ignored', reason: 'duplicate' } : { kind: 'unavailable', reason: 'conflicting-source' };
    if (this.records.size >= this.maxRecords) return { kind: 'unavailable', reason: 'capacity-exceeded' };
    this.records.set(key, agent);
    if (input.delivery === 'history') return { kind: 'ignored', reason: 'history' };
    return { kind: 'observed', activity: { activityId: `activity-v1-${key}`, agentId: input.agentId,
      kind: 'running-command', summary: 'Ran a command.', occurredAt: input.observedAt, sourceItemId: null, source: input.source } };
  }
}
