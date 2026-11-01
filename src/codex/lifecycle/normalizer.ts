import { createHash } from 'node:crypto';
import type { TurnLifecycleObservation, TurnLifecycleStatus } from '../../shared/turn-lifecycle.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value;
const seconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface TurnLifecycleInput {
  source: 'codex' | 'fixture';
  /** Stable private source scope, not a reconnect epoch. Only its digest leaves this module. */
  sourceNamespace: string;
  threadId: string;
  agentId: string;
  observedAt: string;
  delivery: 'live' | 'history';
  format: 'notification' | 'history-turn';
  /** RPC notification, or {threadId, turn} from an already correlated history response. */
  value: unknown;
  /** Required to establish present work from historical inProgress, verified independently. */
  currentThreadActive?: boolean;
}
export type TurnLifecycleResult =
  | { kind: 'observed'; observation: TurnLifecycleObservation }
  | { kind: 'unavailable'; reason: 'invalid-context' | 'missing-correlation' | 'unverified-outcome' }
  | { kind: 'ignored'; reason: 'unsupported' };

/**
 * Strict allowlist for source-projected Turns. A turn/completed method name,
 * runtime idle/error, a command failure, or raw task_complete is not an outcome.
 * Caller owns source trust, cwd scoping, ordered delivery and baseline/live split.
 * This pure boundary retains no transcript, error detail, or raw source identity.
 */
export function normalizeTurnLifecycle(input: TurnLifecycleInput): TurnLifecycleResult {
  if ((input.source !== 'codex' && input.source !== 'fixture') || !identity(input.sourceNamespace)
      || !identity(input.threadId) || !identity(input.agentId)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(input.observedAt)
      || !Number.isFinite(Date.parse(input.observedAt)) || !['live', 'history'].includes(input.delivery)) {
    return { kind: 'unavailable', reason: 'invalid-context' };
  }
  const value = input.value;
  let turn: Obj;
  let method: unknown;
  if (input.format === 'notification') {
    if (!object(value) || !['turn/started', 'turn/completed'].includes(value.method as string)) return { kind: 'ignored', reason: 'unsupported' };
    if (!object(value.params) || value.params.threadId !== input.threadId || !object(value.params.turn)) return { kind: 'unavailable', reason: 'missing-correlation' };
    method = value.method;
    turn = value.params.turn;
  } else if (input.format === 'history-turn') {
    if (!object(value) || value.threadId !== input.threadId || !object(value.turn)) return { kind: 'unavailable', reason: 'missing-correlation' };
    turn = value.turn;
  } else return { kind: 'ignored', reason: 'unsupported' };
  if (!identity(turn.id)) return { kind: 'unavailable', reason: 'missing-correlation' };
  const statuses: Record<string, TurnLifecycleStatus> = { inProgress: 'started', completed: 'succeeded', failed: 'failed', interrupted: 'interrupted' };
  const status = typeof turn.status === 'string' && Object.hasOwn(statuses, turn.status) ? statuses[turn.status] : undefined;
  if (!status || (method === 'turn/started' && status !== 'started') || (method === 'turn/completed' && status === 'started')
      || ((status === 'started' || status === 'succeeded') && turn.error != null)) return { kind: 'unavailable', reason: 'unverified-outcome' };
  // Legacy history can synthesize Completed for implicit turns with no terminal
  // event. InProgress history also does not prove a still-running session.
  if (input.format === 'history-turn' && (status === 'started'
      ? input.currentThreadActive !== true || !seconds(turn.startedAt)
      : !seconds(turn.completedAt))) return { kind: 'unavailable', reason: 'unverified-outcome' };
  if ((turn.startedAt != null && !seconds(turn.startedAt)) || (turn.completedAt != null && !seconds(turn.completedAt))
      || (seconds(turn.startedAt) && seconds(turn.completedAt) && turn.completedAt < turn.startedAt)) return { kind: 'unavailable', reason: 'unverified-outcome' };
  const key = digest(['turn-v1', input.source, input.sourceNamespace, input.threadId, turn.id]);
  return { kind: 'observed', observation: {
    agentId: input.agentId, turnId: `turn-v1-${key}`, sourceEventId: `turn-event-v1-${digest([key, status])}`,
    status, source: input.source, delivery: input.delivery, occurredAt: input.observedAt,
    startedAt: seconds(turn.startedAt) ? turn.startedAt : null,
  } };
}
