/**
 * Pure request lifecycle for a future proven response adapter.
 *
 * This module grants no runtime permission. The adapter must supply evidence for
 * each request, validate its kind-specific answer, and serialize canDispatch
 * with its transport write, with no await gap. Source observations alone clear attention.
 */
export type SourceRequestId = string | number;
export type RequestKind =
  | 'command-approval'
  | 'file-change-approval'
  | 'permission-approval'
  | 'user-input'
  | 'unknown';

export interface RequestIdentity {
  readonly daemonId: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly sourceRequestId: SourceRequestId;
}
export type ResponseCapability =
  | { readonly supported: false; readonly reason: string }
  | { readonly supported: true; readonly evidenceId: string };

export interface PendingObservation {
  readonly identity: RequestIdentity;
  /** Opaque runtime revision, when available. Never compared lexicographically. */
  readonly sourceRevision: string | null;
  /** Adapter-monotonic ordering within this connection; not a wall-clock time. */
  readonly observationSequence: number;
  readonly kind: RequestKind;
  readonly capability: ResponseCapability;
}
export type ResolutionReason = 'answered' | 'cancelled' | 'interrupted' | 'cleared' | 'unknown';
export interface ResolutionObservation {
  readonly identity: RequestIdentity;
  readonly sourceRevision: string | null;
  readonly observationSequence: number;
  readonly reason: ResolutionReason;
}
export type AttemptStatus = 'in-flight' | 'acknowledged' | 'not-sent' | 'uncertain';
export interface ResponseAttempt {
  readonly idempotencyKey: string;
  readonly responseFingerprint: string;
  readonly sourceRevision: string | null;
  readonly revision: number;
  readonly status: AttemptStatus;
  readonly message: string | null;
}
export interface RequestState {
  readonly identity: RequestIdentity;
  readonly sourceRevision: string | null;
  /** Local CAS revision always exists, including for unversioned source requests. */
  readonly revision: number;
  readonly observationSequence: number;
  readonly kind: RequestKind;
  readonly capability: ResponseCapability;
  readonly connected: boolean;
  readonly sourceState: 'pending' | 'resolved';
  readonly resolution: ResolutionReason | null;
  readonly attempts: readonly ResponseAttempt[];
}
export interface ResponseCommand {
  readonly identity: RequestIdentity;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  /** Computed by the bridge from a validated canonical response, never trusted from the browser. */
  readonly responseFingerprint: string;
  readonly kind: RequestKind;
}
export interface SubmissionLease {
  readonly identity: RequestIdentity;
  readonly sourceRevision: string | null;
  readonly revision: number;
  readonly idempotencyKey: string;
  readonly responseFingerprint: string;
}
export type ResponseOutcome =
  | { readonly status: 'ready'; readonly lease: SubmissionLease }
  | { readonly status: 'duplicate'; readonly attempt: ResponseAttempt }
  | { readonly status: 'stale'; readonly reason: string }
  | { readonly status: 'already-resolved'; readonly reason: ResolutionReason }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };
export interface ResponseTransition {
  readonly state: RequestState;
  readonly outcome: ResponseOutcome;
}
export type SubmissionOutcome =
  | { readonly status: 'acknowledged' }
  | { readonly status: 'not-sent'; readonly reason: string }
  | { readonly status: 'uncertain'; readonly reason: string };
export interface ObservationTransition {
  readonly state: RequestState;
  readonly status: 'applied' | 'duplicate' | 'stale' | 'wrong-request';
}

const copyCapability = (capability: ResponseCapability): ResponseCapability =>
  Object.freeze({ ...capability });
const immutable = (state: RequestState): RequestState =>
  Object.freeze({ ...state, identity: Object.freeze({ ...state.identity }),
    capability: copyCapability(state.capability),
    attempts: Object.freeze(state.attempts.map(attempt => Object.freeze({ ...attempt }))) });

export function sameRequest(a: RequestIdentity, b: RequestIdentity): boolean {
  return a.daemonId === b.daemonId && a.connectionId === b.connectionId
    && a.agentId === b.agentId && a.sourceRequestId === b.sourceRequestId;
}

/** JSON tuples preserve both delimiters and numeric versus string RPC identifiers. */
export function requestKey(identity: RequestIdentity): string {
  validIdentity(identity);
  return JSON.stringify([identity.daemonId, identity.connectionId, identity.agentId,
    typeof identity.sourceRequestId, identity.sourceRequestId]);
}

function validIdentity(identity: RequestIdentity): void {
  if (![identity.daemonId, identity.connectionId, identity.agentId].every(value => value.trim().length > 0)
    || (typeof identity.sourceRequestId === 'number'
      ? !Number.isSafeInteger(identity.sourceRequestId) : identity.sourceRequestId.length === 0)) {
    throw new Error('A complete daemon, connection, agent and JSON-RPC request identity is required');
  }
}

function validSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('observationSequence must be a non-negative safe integer');
  }
}

export function createRequest(observation: PendingObservation): RequestState {
  validIdentity(observation.identity);
  validSequence(observation.observationSequence);
  return immutable({
    identity: observation.identity, sourceRevision: observation.sourceRevision,
    revision: 1, observationSequence: observation.observationSequence,
    kind: observation.kind, capability: observation.capability, connected: true,
    sourceState: 'pending', resolution: null, attempts: [],
  });
}

/**
 * Replayed snapshots cannot resurrect a resolved request. A new occurrence
 * needs a new identity. Reconnection requires a
 * new connection identity and fresh ownership evidence, not this function.
 */
export function observePending(state: RequestState, observation: PendingObservation): ObservationTransition {
  validSequence(observation.observationSequence);
  if (!sameRequest(state.identity, observation.identity)) return { state, status: 'wrong-request' };
  if (!state.connected || observation.observationSequence < state.observationSequence) {
    return { state, status: 'stale' };
  }
  if (observation.observationSequence === state.observationSequence) return { state, status: 'duplicate' };
  const revisionChanged = observation.sourceRevision !== state.sourceRevision;
  if (state.sourceState === 'resolved') return { state, status: 'stale' };
  if (!revisionChanged && state.kind !== observation.kind) return { state, status: 'stale' };
  const capabilityChanged = JSON.stringify(state.capability) !== JSON.stringify(observation.capability);
  return { status: 'applied', state: immutable({
    ...state, sourceRevision: observation.sourceRevision,
    observationSequence: observation.observationSequence,
    revision: state.revision + (revisionChanged || capabilityChanged ? 1 : 0),
    kind: observation.kind, capability: observation.capability,
    sourceState: 'pending', resolution: null,
  }) };
}

/** A queued authoritative resolution may close its exact old request after disconnect; it cannot match a new connection. */
export function observeResolution(state: RequestState, observation: ResolutionObservation): ObservationTransition {
  validSequence(observation.observationSequence);
  if (!sameRequest(state.identity, observation.identity)) return { state, status: 'wrong-request' };
  if (observation.sourceRevision !== state.sourceRevision
    || observation.observationSequence < state.observationSequence) return { state, status: 'stale' };
  if (state.sourceState === 'resolved' || observation.observationSequence === state.observationSequence) {
    return { state, status: 'duplicate' };
  }
  return { status: 'applied', state: immutable({
    ...state, observationSequence: observation.observationSequence,
    revision: state.revision + 1, sourceState: 'resolved', resolution: observation.reason,
  }) };
}

export function invalidateConnection(state: RequestState, reason = 'Request connection was lost; ownership must be verified again.'): RequestState {
  if (!state.connected) return state;
  return immutable({ ...state, connected: false, revision: state.revision + 1,
    capability: { supported: false, reason } });
}

export function needsAttention(state: RequestState): boolean {
  return state.sourceState === 'pending';
}

export function beginResponse(state: RequestState, command: ResponseCommand): ResponseTransition {
  const reject = (outcome: ResponseOutcome): ResponseTransition => ({ state, outcome });
  if (!sameRequest(state.identity, command.identity) || state.kind !== command.kind) {
    return reject({ status: 'stale', reason: 'Request identity or kind does not match.' });
  }
  if (state.sourceState === 'resolved') return reject({ status: 'already-resolved', reason: state.resolution ?? 'unknown' });
  if (!state.connected || state.revision !== command.expectedRevision) {
    return reject({ status: 'stale', reason: 'Request revision or connection is no longer current.' });
  }
  if (!command.idempotencyKey || !command.responseFingerprint) {
    return reject({ status: 'failed', reason: 'An idempotency key and canonical response fingerprint are required.' });
  }
  const previous = state.attempts.find(attempt => attempt.idempotencyKey === command.idempotencyKey);
  if (previous) {
    if (previous.responseFingerprint !== command.responseFingerprint || previous.sourceRevision !== state.sourceRevision) {
      return reject({ status: 'failed', reason: 'Idempotency key was already used for a different response or request revision.' });
    }
    return reject({ status: 'duplicate', attempt: previous });
  }
  const active = state.attempts.find(attempt => attempt.status !== 'not-sent');
  if (active) return reject({ status: 'duplicate', attempt: active });
  if (!state.capability.supported) return reject({ status: 'unsupported', reason: state.capability.reason });
  if (!state.capability.evidenceId.trim() || state.kind === 'unknown') {
    return reject({ status: 'unsupported', reason: 'This request lacks verified response ownership or a supported schema.' });
  }
  const attempt: ResponseAttempt = Object.freeze({
    idempotencyKey: command.idempotencyKey, responseFingerprint: command.responseFingerprint,
    sourceRevision: state.sourceRevision, revision: state.revision,
    status: 'in-flight', message: null,
  });
  const lease: SubmissionLease = Object.freeze({
    identity: state.identity, sourceRevision: state.sourceRevision,
    revision: state.revision, idempotencyKey: command.idempotencyKey,
    responseFingerprint: command.responseFingerprint,
  });
  return { state: immutable({ ...state, attempts: [...state.attempts, attempt] }),
    outcome: { status: 'ready', lease } };
}

/** Check immediately before transport write, serialized with observations and with no await gap. */
export function canDispatch(state: RequestState, lease: SubmissionLease): boolean {
  return state.connected && state.sourceState === 'pending'
    && sameRequest(state.identity, lease.identity)
    && state.revision === lease.revision && state.sourceRevision === lease.sourceRevision
    && state.capability.supported && state.capability.evidenceId.trim().length > 0
    && state.kind !== 'unknown'
    && state.attempts.some(attempt => attempt.status === 'in-flight'
      && attempt.idempotencyKey === lease.idempotencyKey
      && attempt.responseFingerprint === lease.responseFingerprint
      && attempt.revision === lease.revision && attempt.sourceRevision === lease.sourceRevision);
}
/** Transport acknowledgment is not source resolution, including after cancellation. */
export function recordSubmission(state: RequestState, lease: SubmissionLease, outcome: SubmissionOutcome): RequestState {
  if (!sameRequest(state.identity, lease.identity) || state.sourceRevision !== lease.sourceRevision) return state;
  const index = state.attempts.findIndex(attempt => attempt.idempotencyKey === lease.idempotencyKey
    && attempt.revision === lease.revision && attempt.responseFingerprint === lease.responseFingerprint
    && attempt.sourceRevision === lease.sourceRevision);
  if (index < 0 || state.attempts[index].status !== 'in-flight') return state;
  return immutable({ ...state, attempts: state.attempts.map((attempt, i) => i !== index ? attempt : {
    ...attempt, status: outcome.status,
    message: outcome.status === 'acknowledged' ? null : outcome.reason,
  }) });
}