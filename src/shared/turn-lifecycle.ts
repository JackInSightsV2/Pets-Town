/** Presentation evidence, deliberately separate from RuntimeState/session liveness. */
export type TurnLifecycleStatus = 'started' | 'succeeded' | 'failed' | 'interrupted';
export interface TurnLifecycleObservation {
  agentId: string;
  /** Opaque source-derived turn and observation keys, never raw rollout identifiers. */
  turnId: string;
  sourceEventId: string;
  status: TurnLifecycleStatus;
  source: 'codex' | 'fixture';
  delivery: 'live' | 'history';
  /** Receipt time; not used for identity or to infer a terminal outcome. */
  occurredAt: string;
  /** Source start time in Unix seconds, when supplied by the verified Turn projection. */
  startedAt: number | null;
}

export function isTurnLifecycleObservation(value: unknown): value is TurnLifecycleObservation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.agentId === 'string' && row.agentId.length > 0 && row.agentId.length <= 4096
    && typeof row.turnId === 'string' && /^turn-v1-[a-f0-9]{64}$/.test(row.turnId)
    && typeof row.sourceEventId === 'string' && /^turn-event-v1-[a-f0-9]{64}$/.test(row.sourceEventId)
    && ['started', 'succeeded', 'failed', 'interrupted'].includes(row.status as string)
    && (row.source === 'codex' || row.source === 'fixture')
    && (row.delivery === 'live' || row.delivery === 'history')
    && typeof row.occurredAt === 'string' && Number.isFinite(Date.parse(row.occurredAt))
    && (row.startedAt === null || (typeof row.startedAt === 'number' && Number.isSafeInteger(row.startedAt) && row.startedAt >= 0));
}
