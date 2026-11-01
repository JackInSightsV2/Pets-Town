import { createHash } from 'node:crypto';
import type { OfficeHandoff } from '../../shared/contract.js';

export type HandoffSource = 'codex' | 'fixture';

/** Supplied by the observer; this module neither connects to nor proves reception from Codex. */
export interface HandoffObservation {
  source: HandoffSource;
  /** Stable runtime identity across reconnects, not a bridge epoch, socket path or polling sequence. */
  sourceNamespace: string;
  /** Receipt time, explicitly not inferred native event time. Excluded from identity. */
  observedAt: string;
  /** History/snapshot catch-up is remembered without emitting a new meeting. */
  delivery: 'live' | 'history';
  notification: unknown;
}
export interface HandoffCorrelation {
  source: HandoffSource;
  sourceNamespace: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: 'subAgentActivity/interacted';
}
export interface HandoffRecord extends HandoffCorrelation { toAgentId: string }
export interface HandoffCheckpoint { version: 1; records: HandoffRecord[] }
export type HandoffResult =
  | { kind: 'observed'; source: HandoffSource; correlation: HandoffCorrelation; handoffs: OfficeHandoff[] }
  | { kind: 'ignored'; reason: 'not-an-exchange' | 'duplicate' | 'history' }
  | { kind: 'unavailable'; reason: 'invalid-context' | 'missing-source-correlation' | 'inconsistent-participants' | 'unverified-exchange-outcome' | 'conflicting-source' | 'capacity-exceeded' };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value;
const source = (value: unknown): value is HandoffSource => value === 'codex' || value === 'fixture';
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function key(record: HandoffCorrelation): string {
  return JSON.stringify([record.source, record.sourceNamespace, record.threadId, record.turnId, record.itemId]);
}
function handoffId(record: HandoffRecord): string {
  // Source identity + destination, never arrival time, bridge seq or display name.
  return 'handoff-v1-' + createHash('sha256').update(JSON.stringify([key(record), record.toAgentId])).digest('hex');
}
function checkpointRecord(value: unknown): HandoffRecord | null {
  if (!object(value) || !source(value.source) || !identity(value.sourceNamespace) || !identity(value.threadId) ||
      !identity(value.turnId) || !identity(value.itemId) || value.kind !== 'subAgentActivity/interacted' ||
      !identity(value.toAgentId) || value.toAgentId === value.threadId) return null;
  return { source: value.source, sourceNamespace: value.sourceNamespace, threadId: value.threadId,
    turnId: value.turnId, itemId: value.itemId, kind: value.kind, toAgentId: value.toAgentId };
}

/**
 * Source-backed normalization, not a live adapter. The v2 message handler emits
 * subAgentActivity/interacted only after a successful send receipt; accept its
 * item/completed projection once. Legacy collabAgentToolCall completion alone
 * does not establish successful delivery and stays unavailable.
 *
 * Keep the instance/checkpoint across reconnect and presentation reset.
 * Capacity fails closed: records are never silently evicted and replayed again.
 */
export class HandoffNormalizer {
  private readonly records = new Map<string, HandoffRecord>();
  private readonly maxRecords: number;

  constructor(options: { maxRecords?: number; checkpoint?: unknown } = {}) {
    this.maxRecords = options.maxRecords ?? 10_000;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) throw new Error('maxRecords must be a positive safe integer.');
    if (options.checkpoint === undefined) return;
    const checkpoint = options.checkpoint;
    if (!object(checkpoint) || checkpoint.version !== 1 || !Array.isArray(checkpoint.records) || checkpoint.records.length > this.maxRecords) {
      throw new Error('Invalid or oversized handoff checkpoint.');
    }
    for (const value of checkpoint.records) {
      const record = checkpointRecord(value);
      if (!record) throw new Error('Invalid handoff checkpoint record.');
      const recordKey = key(record);
      const previous = this.records.get(recordKey);
      if (previous && previous.toAgentId !== record.toAgentId) throw new Error('Conflicting handoff checkpoint records.');
      this.records.set(recordKey, record);
    }
  }

  checkpoint(): HandoffCheckpoint {
    return { version: 1, records: [...this.records.values()].map(record => ({ ...record })) };
  }

  observe(observation: HandoffObservation): HandoffResult {
    if (!source(observation.source) || !identity(observation.sourceNamespace) || !timestamp(observation.observedAt) ||
        (observation.delivery !== 'live' && observation.delivery !== 'history')) return { kind: 'unavailable', reason: 'invalid-context' };
    const notification = observation.notification;
    if (!object(notification) || notification.method !== 'item/completed') return { kind: 'ignored', reason: 'not-an-exchange' };
    const params = notification.params;
    if (!object(params) || !object(params.item)) return { kind: 'unavailable', reason: 'missing-source-correlation' };
    const item = params.item;
    if (item.type === 'collabAgentToolCall') return { kind: 'unavailable', reason: 'unverified-exchange-outcome' };
    if (item.type !== 'subAgentActivity' || item.kind !== 'interacted') return { kind: 'ignored', reason: 'not-an-exchange' };
    if (!identity(params.threadId) || !identity(params.turnId) || !identity(item.id) || !identity(item.agentThreadId)) {
      return { kind: 'unavailable', reason: 'missing-source-correlation' };
    }
    if (params.threadId === item.agentThreadId || ('senderThreadId' in item && item.senderThreadId !== params.threadId)) {
      return { kind: 'unavailable', reason: 'inconsistent-participants' };
    }
    const record: HandoffRecord = {
      source: observation.source, sourceNamespace: observation.sourceNamespace,
      threadId: params.threadId, turnId: params.turnId, itemId: item.id,
      kind: 'subAgentActivity/interacted', toAgentId: item.agentThreadId,
    };
    const recordKey = key(record);
    const previous = this.records.get(recordKey);
    if (previous) return previous.toAgentId === record.toAgentId
      ? { kind: 'ignored', reason: 'duplicate' } : { kind: 'unavailable', reason: 'conflicting-source' };
    if (this.records.size >= this.maxRecords) return { kind: 'unavailable', reason: 'capacity-exceeded' };
    this.records.set(recordKey, record);
    if (observation.delivery === 'history') return { kind: 'ignored', reason: 'history' };
    const { toAgentId, ...correlation } = record;
    return {
      kind: 'observed', source: observation.source, correlation,
      handoffs: [{
        handoffId: handoffId(record), fromAgentId: record.threadId, toAgentId,
        // This source proves a send, but exposes no text to summarize.
        summary: 'Sent a message.', occurredAt: observation.observedAt, sourceItemId: record.itemId,
      }],
    };
  }
}
