import { normalizeTurnLifecycle, type TurnLifecycleResult } from './normalizer.js';
import type { TurnLifecycleStatus } from '../../shared/turn-lifecycle.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value;
const seconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalTime = (value: unknown) => value == null || seconds(value);
const observedTime = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && Number.isFinite(Date.parse(value));

/** Private staging record: no messages, error details, paths or transcript items. */
export type ProjectedRolloutLifecycleRecord = { projection: 'rollout-lifecycle-v1'; ordinal: number | null } & (
  | { kind: 'started'; turnId: string; startedAt: number | null; recordedAt: string | null }
  | { kind: 'completed'; turnId: string; startedAt: number | null; completedAt: number | null; hasError: boolean }
  | { kind: 'aborted'; turnId: string | null; startedAt: number | null; completedAt: number | null }
  | { kind: 'error'; affectsTurn: boolean }
  | { kind: 'invalid' }
);

const failureCodes = new Set(['context_window_exceeded', 'session_budget_exceeded', 'usage_limit_exceeded',
  'rate_limit_exceeded', 'flex_unavailable', 'server_overloaded', 'model_not_found', 'policy_capacity_unavailable',
  'cyber_policy', 'bio_policy', 'misalignment_policy_violation', 'too_many_denials', 'internal_server_error',
  'unauthorized', 'bad_request', 'invalid_prompt', 'sandbox_error', 'other']);
const httpCodes = new Set(['http_connection_failed', 'response_stream_connection_failed',
  'response_stream_disconnected', 'response_too_many_failed_attempts']);

/** Verified 0.166.0-alpha.5.1/0.166.0 rule. Unknown/malformed codes remain unavailable. */
function errorAffectsTurn(error: Obj): boolean | null {
  const code = error.codex_error_info;
  if (code == null) return true;
  if (code === 'thread_rollback_failed') return false;
  if (typeof code === 'string') return failureCodes.has(code) ? true : null;
  if (!object(code) || Object.keys(code).length !== 1) return null;
  if (object(code.active_turn_not_steerable)) {
    return ['review', 'compact'].includes(code.active_turn_not_steerable.turn_kind as string) ? false : null;
  }
  const key = Object.keys(code)[0], detail = code[key];
  if (!httpCodes.has(key) || !object(detail)) return null;
  const status = detail.http_status_code;
  return status == null || (typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 65535) ? true : null;
}

/** Strip private fields before a reader stages a validated file transaction. */
export function projectRolloutLifecycleRecord(value: unknown): ProjectedRolloutLifecycleRecord | null {
  if (!object(value) || value.type !== 'event_msg') return null;
  const invalid: ProjectedRolloutLifecycleRecord = { projection: 'rollout-lifecycle-v1',
    ordinal: seconds(value.ordinal) ? value.ordinal : null, kind: 'invalid' };
  if (!object(value.payload)) return invalid;
  const payload = value.payload;
  const base = { projection: 'rollout-lifecycle-v1' as const, ordinal: seconds(value.ordinal) ? value.ordinal : null };
  switch (payload.type) {
    case 'task_started': case 'turn_started':
      if (!identity(payload.turn_id) || !optionalTime(payload.started_at)) return invalid;
      return { ...base, kind: 'started', turnId: payload.turn_id, startedAt: seconds(payload.started_at) ? payload.started_at : null,
        recordedAt: observedTime(value.timestamp) ? value.timestamp : null };
    case 'task_complete': case 'turn_complete':
      if (!identity(payload.turn_id) || !optionalTime(payload.started_at) || !optionalTime(payload.completed_at)
          || (payload.error != null && (!object(payload.error) || typeof payload.error.message !== 'string'))) return invalid;
      return { ...base, kind: 'completed', turnId: payload.turn_id,
        startedAt: seconds(payload.started_at) ? payload.started_at : null,
        completedAt: seconds(payload.completed_at) ? payload.completed_at : null, hasError: payload.error != null };
    case 'turn_aborted':
      if ((payload.turn_id != null && !identity(payload.turn_id)) || !optionalTime(payload.started_at) || !optionalTime(payload.completed_at)
          || !['interrupted', 'replaced', 'review_ended', 'budget_limited'].includes(payload.reason as string)
          || (payload.error != null && (!object(payload.error) || typeof payload.error.message !== 'string'))) return invalid;
      return { ...base, kind: 'aborted', turnId: identity(payload.turn_id) ? payload.turn_id : null,
        startedAt: seconds(payload.started_at) ? payload.started_at : null,
        completedAt: seconds(payload.completed_at) ? payload.completed_at : null };
    case 'error': {
      if (typeof payload.message !== 'string') return invalid;
      const affectsTurn = errorAffectsTurn(payload);
      return affectsTurn === null ? invalid : { ...base, kind: 'error', affectsTurn };
    }
    // Reconstructing removed turns is outside this presentation projection.
    // Invalidate rather than keep a terminal baseline from rolled-back history.
    case 'thread_rolled_back': return invalid;
    default: return null;
  }
}

function isProjection(value: unknown): value is ProjectedRolloutLifecycleRecord {
  if (!object(value) || value.projection !== 'rollout-lifecycle-v1' || (value.ordinal !== null && !seconds(value.ordinal))) return false;
  switch (value.kind) {
    case 'invalid': return true;
    case 'error': return typeof value.affectsTurn === 'boolean';
    case 'started': return identity(value.turnId) && (value.startedAt === null || seconds(value.startedAt))
      && (value.recordedAt === null || observedTime(value.recordedAt));
    case 'completed': case 'aborted': return (identity(value.turnId) || (value.kind === 'aborted' && value.turnId === null))
      && (value.startedAt === null || seconds(value.startedAt)) && (value.completedAt === null || seconds(value.completedAt))
      && (value.kind === 'aborted' || typeof value.hasError === 'boolean');
    default: return false;
  }
}

export interface RolloutLifecycleProjectorOptions {
  source: 'codex' | 'fixture';
  sourceNamespace: string;
  threadId: string;
  agentId: string;
  maxTurns?: number;
}
export interface RolloutLifecycleContext { delivery: 'live' | 'history'; observedAt: string }
interface TurnState {
  id: string;
  startedAt: number | null;
  recordedAt: string | null;
  ordinal: number | null;
  status: TurnLifecycleStatus;
  terminal: boolean;
  ambiguous: boolean;
  liveStart: boolean;
  emitted: Set<TurnLifecycleStatus>;
}
const ignored = (): TurnLifecycleResult => ({ kind: 'ignored', reason: 'unsupported' });
const unavailable = (): TurnLifecycleResult => ({ kind: 'unavailable', reason: 'unverified-outcome' });

/**
 * Bounded, source-ordered projection for the verified rollout event contract.
 * The caller verifies runtime/source support and session identity/cwd, passes
 * complete records in file order, and commits a clone only after file validation.
 * It never infers completion from metadata, a missing process, or tool output.
 * Historical starts do not establish present work. Explicit correlated terminal
 * records do establish a silent baseline, even when their optional time is absent.
 * Source: openai/codex f79b26ccbb3116b052544666a181012fb45dc49b,
 * app-server-protocol/src/protocol/thread_history.rs:1377-1504. These lifecycle
 * handlers are identical in the 0.166.0 release (6ff1e1ca3b30fc8b914720681fcf5fe62e95f856).
 */
export class RolloutLifecycleProjector {
  private readonly options: RolloutLifecycleProjectorOptions;
  private readonly maxTurns: number;
  private turns = new Map<string, TurnState>();
  private activeId: string | null = null;
  private latestId: string | null = null;
  private latestReliable = true;
  private capacityExceeded = false;

  constructor(options: RolloutLifecycleProjectorOptions) {
    if (!options || !['codex', 'fixture'].includes(options.source) || !identity(options.sourceNamespace)
        || !identity(options.threadId) || !identity(options.agentId)
        || (options.maxTurns !== undefined && (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 100_000))) {
      throw new Error('Invalid rollout lifecycle scope or capacity.');
    }
    this.options = { ...options };
    this.maxTurns = options.maxTurns ?? 4096;
  }

  /** Reader can discard this clone if any later record/file identity check fails. */
  clone(): RolloutLifecycleProjector {
    const copy = new RolloutLifecycleProjector(this.options);
    copy.turns = new Map([...this.turns].map(([id, turn]) => [id, { ...turn, emitted: new Set(turn.emitted) }]));
    copy.activeId = this.activeId; copy.latestId = this.latestId;
    copy.latestReliable = this.latestReliable; copy.capacityExceeded = this.capacityExceeded;
    return copy;
  }

  observe(value: unknown, context: RolloutLifecycleContext): TurnLifecycleResult {
    if (!context || !observedTime(context.observedAt) || !['live', 'history'].includes(context.delivery)) {
      return { kind: 'unavailable', reason: 'invalid-context' };
    }
    if (this.capacityExceeded) return unavailable();
    if (object(value) && value.projection === 'rollout-lifecycle-v1' && !isProjection(value)) return this.ambiguous();
    const record = isProjection(value) ? value : projectRolloutLifecycleRecord(value);
    if (!record) return ignored();
    if (record.kind === 'invalid') return this.ambiguous();
    if (record.kind === 'started') {
      const previous = this.turns.get(record.turnId);
      if (previous) {
        if (record.startedAt !== previous.startedAt) return this.ambiguous();
        return ignored();
      }
      if (this.turns.size >= this.maxTurns) { this.capacityExceeded = true; return unavailable(); }
      const turn: TurnState = { id: record.turnId, startedAt: record.startedAt, recordedAt: record.recordedAt, ordinal: record.ordinal, status: 'started', terminal: false,
        ambiguous: false, liveStart: context.delivery === 'live', emitted: new Set() };
      this.turns.set(turn.id, turn);
      this.activeId = this.latestId = turn.id; this.latestReliable = true;
      // Scanning an old start seeds correlation, but cannot claim present work.
      if (context.delivery === 'history') return unavailable();
      return this.emit(turn, context);
    }
    if (record.kind === 'error') {
      if (!record.affectsTurn) return ignored();
      const active = this.activeId ? this.turns.get(this.activeId) : undefined;
      if (!active) return unavailable();
      // The verified producer takes a RunningTask once before emitting its
      // terminal boundary. Cleanup errors cannot reopen an interrupted turn.
      if (active.terminal) return ignored();
      active.status = 'failed';
      active.terminal = false;
      // Failure becomes presentation evidence only at an explicit terminal boundary.
      return ignored();
    }
    const turn = record.turnId ? this.turns.get(record.turnId) : undefined;
    if (!turn) return this.ambiguous();
    if ((record.startedAt !== null && turn.startedAt !== null && record.startedAt !== turn.startedAt)
        || (record.completedAt !== null && turn.startedAt !== null && record.completedAt < turn.startedAt)) {
      // Reject contradictory timing without damaging an already validated
      // terminal. Only the first terminal can establish this turn's outcome.
      if (turn.terminal) return unavailable();
      turn.ambiguous = true;
      if (this.latestId === turn.id) this.latestReliable = false;
      return unavailable();
    }
    if (turn.ambiguous) return unavailable();
    // First explicit correlated terminal is authoritative in both live delivery
    // and full-history bootstrap. The producer emits TurnAborted OR TurnComplete
    // for that task, never a later terminal revision (tasks/mod.rs:603-699,
    // 857-889, 977-1072 at f79b26cc). Keep correlation/timing validation above;
    // simply deduplicating emit() would still let latest() silently diverge.
    if (turn.terminal) return ignored();
    if (record.kind === 'aborted') turn.status = 'interrupted';
    else if (record.hasError) turn.status = 'failed';
    else if (turn.status === 'started') turn.status = 'succeeded';
    turn.terminal = true;
    // Retaining the abort correlation does not authorize later cleanup records
    // to revise its already-established outcome.
    if (record.kind === 'completed' && this.activeId === turn.id) this.activeId = null;
    return this.emit(turn, context);
  }

  /** Newest source-started turn only; never replay all historical transitions. */
  latest(context: { observedAt: string; currentThreadActive?: boolean }): TurnLifecycleResult {
    if (!context || !observedTime(context.observedAt)) return { kind: 'unavailable', reason: 'invalid-context' };
    const turn = this.latestId ? this.turns.get(this.latestId) : undefined;
    if (this.capacityExceeded || !this.latestReliable || !turn || turn.ambiguous) return unavailable();
    if (!turn.terminal && (turn.status !== 'started' || (!turn.liveStart && context.currentThreadActive !== true))) return unavailable();
    return this.normalized(turn, { delivery: 'history', observedAt: context.observedAt });
  }

  /** Private reader evidence for its separately verified fresh-file discovery. */
  latestStart(): Extract<ProjectedRolloutLifecycleRecord, { kind: 'started' }> | null {
    const turn = this.latestId ? this.turns.get(this.latestId) : undefined;
    if (this.capacityExceeded || !this.latestReliable || !turn || turn.ambiguous || turn.terminal || turn.status !== 'started') return null;
    return { projection: 'rollout-lifecycle-v1', kind: 'started', turnId: turn.id, ordinal: turn.ordinal,
      startedAt: turn.startedAt, recordedAt: turn.recordedAt };
  }

  /** Caller has independently established that the seeded start is current. */
  confirmLiveStart(context: { observedAt: string }): TurnLifecycleResult {
    if (!context || !observedTime(context.observedAt)) return { kind: 'unavailable', reason: 'invalid-context' };
    if (!this.latestStart()) return unavailable();
    const turn = this.turns.get(this.latestId!)!;
    turn.liveStart = true;
    return this.emit(turn, { observedAt: context.observedAt, delivery: 'live' });
  }

  private ambiguous(): TurnLifecycleResult {
    const active = this.activeId ? this.turns.get(this.activeId) : undefined;
    if (active) active.ambiguous = true;
    this.latestReliable = false;
    return unavailable();
  }

  private normalized(turn: TurnState, context: RolloutLifecycleContext): TurnLifecycleResult {
    const status = { started: 'inProgress', succeeded: 'completed', failed: 'failed', interrupted: 'interrupted' }[turn.status];
    // This shape is justified by an actual source boundary consumed above, not
    // an arbitrary raw task_complete or a reconstructed default history status.
    return normalizeTurnLifecycle({ ...this.options, ...context, format: 'notification',
      value: { method: turn.status === 'started' ? 'turn/started' : 'turn/completed',
        params: { threadId: this.options.threadId, turn: { id: turn.id, status, startedAt: turn.startedAt } } } });
  }

  private emit(turn: TurnState, context: RolloutLifecycleContext): TurnLifecycleResult {
    if (turn.emitted.has(turn.status)) return ignored();
    const result = this.normalized(turn, context);
    if (result.kind === 'observed') turn.emitted.add(turn.status);
    return result;
  }
}

export function createRolloutLifecycleProjector(options: RolloutLifecycleProjectorOptions): RolloutLifecycleProjector {
  return new RolloutLifecycleProjector(options);
}
