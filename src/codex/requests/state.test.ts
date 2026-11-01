import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginResponse, canDispatch, createRequest, invalidateConnection, needsAttention,
  observePending, observeResolution, recordSubmission, requestKey,
  type PendingObservation, type RequestIdentity, type RequestState,
  type ResponseCommand, type SubmissionLease,
} from './state.js';

// All correlation and ownership values are explicit fixtures, not live evidence.
const identity: RequestIdentity = Object.freeze({
  daemonId: 'fixture-daemon', connectionId: 'fixture-connection-1',
  agentId: 'fixture-existing-agent', sourceRequestId: 17,
});
const observation = (overrides: Partial<PendingObservation> = {}): PendingObservation => ({
  identity, sourceRevision: 'fixture-revision-1', observationSequence: 10,
  kind: 'command-approval', capability: { supported: true, evidenceId: 'fixture-only-owned-recipient' },
  ...overrides,
});
const command = (state: RequestState, overrides: Partial<ResponseCommand> = {}): ResponseCommand => ({
  identity: state.identity, expectedRevision: state.revision, kind: state.kind,
  idempotencyKey: 'fixture-click-1', responseFingerprint: 'fixture-canonical-response-A',
  ...overrides,
});
function reserve(state: RequestState): { state: RequestState; lease: SubmissionLease } {
  const transition = beginResponse(state, command(state));
  assert.equal(transition.outcome.status, 'ready');
  if (transition.outcome.status !== 'ready') throw new Error('Fixture reservation failed');
  return { state: transition.state, lease: transition.outcome.lease };
}

test('exact key retains daemon, connection, agent, ID type and delimiters', () => {
  const original = requestKey(identity);
  for (const change of [
    { daemonId: 'another-daemon' }, { connectionId: 'another-connection' },
    { agentId: 'another-agent' }, { sourceRequestId: '17' }, { sourceRequestId: 18 },
  ]) assert.notEqual(requestKey({ ...identity, ...change }), original);
  assert.notEqual(
    requestKey({ ...identity, daemonId: 'a:b', connectionId: 'c' }),
    requestKey({ ...identity, daemonId: 'a', connectionId: 'b:c' }),
  );
});

test('invalid identities and observation clocks are rejected before correlation', () => {
  assert.throws(() => createRequest(observation({ identity: { ...identity, sourceRequestId: NaN } })));
  assert.throws(() => createRequest(observation({ identity: { ...identity, agentId: '' } })));
  assert.throws(() => createRequest(observation({ observationSequence: -1 })));
});

test('reservation is immutable and duplicate clicks cannot reserve a second write', () => {
  const initial = createRequest(observation());
  const first = reserve(initial);
  assert.equal(initial.attempts.length, 0);
  assert.equal(first.state.attempts.length, 1);
  assert.equal(Object.isFrozen(first.state), true);
  assert.equal(Object.isFrozen(first.state.attempts), true);
  const duplicate = beginResponse(first.state, command(first.state));
  assert.equal(duplicate.outcome.status, 'duplicate');
  assert.equal(duplicate.state, first.state);
  const anotherClick = beginResponse(first.state, command(first.state, { idempotencyKey: 'another-click' }));
  assert.equal(anotherClick.outcome.status, 'duplicate');
});

test('submission acknowledgment retains source pending state and attention', () => {
  const reserved = reserve(createRequest(observation()));
  const acknowledged = recordSubmission(reserved.state, reserved.lease, { status: 'acknowledged' });
  assert.equal(acknowledged.attempts[0].status, 'acknowledged');
  assert.equal(acknowledged.sourceState, 'pending');
  assert.equal(needsAttention(acknowledged), true);
  assert.equal(beginResponse(acknowledged, command(acknowledged)).outcome.status, 'duplicate');
});

test('original-client resolution rejects a later answer without reservation', () => {
  const initial = createRequest(observation());
  const resolved = observeResolution(initial, {
    identity, sourceRevision: initial.sourceRevision, observationSequence: 11, reason: 'answered',
  }).state;
  assert.equal(needsAttention(resolved), false);
  assert.equal(beginResponse(resolved, command(initial)).outcome.status, 'already-resolved');
  assert.equal(resolved.attempts.length, 0);
});

for (const reason of ['cancelled', 'interrupted', 'cleared', 'unknown'] as const) {
  test('source resolution preserves ' + reason + ' and a late acknowledgment cannot approve it', () => {
    const reserved = reserve(createRequest(observation()));
    const resolved = observeResolution(reserved.state, {
      identity, sourceRevision: reserved.state.sourceRevision, observationSequence: 11, reason,
    }).state;
    const lateAcknowledgment = recordSubmission(resolved, reserved.lease, { status: 'acknowledged' });
    assert.equal(lateAcknowledgment.resolution, reason);
    assert.equal(lateAcknowledgment.sourceState, 'resolved');
    assert.equal(needsAttention(lateAcknowledgment), false);
  });
}

test('wrong agent, source request, daemon, connection, ID type and kind never reserve', () => {
  const initial = createRequest(observation());
  for (const change of [
    { agentId: 'wrong-agent' }, { sourceRequestId: 18 }, { sourceRequestId: '17' },
    { daemonId: 'wrong-daemon' }, { connectionId: 'wrong-connection' },
  ]) {
    const result = beginResponse(initial, command(initial, { identity: { ...identity, ...change } }));
    assert.equal(result.outcome.status, 'stale');
    assert.equal(result.state, initial);
  }
  assert.equal(beginResponse(initial, command(initial, { kind: 'file-change-approval' })).outcome.status, 'stale');
});

test('unsupported ownership, empty evidence and unknown schemas cannot reserve', () => {
  const unsupported = createRequest(observation({ capability: { supported: false, reason: 'Metadata has no request body or recipient ownership.' } }));
  assert.equal(beginResponse(unsupported, command(unsupported)).outcome.status, 'unsupported');
  const noEvidence = createRequest(observation({ capability: { supported: true, evidenceId: '' } }));
  assert.equal(beginResponse(noEvidence, command(noEvidence)).outcome.status, 'unsupported');
  const unknown = createRequest(observation({ kind: 'unknown' }));
  assert.equal(beginResponse(unknown, command(unknown)).outcome.status, 'unsupported');
});

test('reconnect invalidates the old route and does not transfer response ownership', () => {
  const initial = createRequest(observation());
  const disconnected = invalidateConnection(initial);
  assert.equal(disconnected.revision, initial.revision + 1);
  assert.equal(needsAttention(disconnected), true);
  assert.equal(beginResponse(disconnected, command(disconnected)).outcome.status, 'stale');
  const replay = observePending(disconnected, observation({ observationSequence: 12 }));
  assert.equal(replay.status, 'stale');
  const newIdentity = { ...identity, connectionId: 'fixture-connection-2' };
  const fresh = createRequest(observation({
    identity: newIdentity, capability: { supported: false, reason: 'Fresh ownership proof required.' },
  }));
  assert.equal(beginResponse(fresh, command(fresh)).outcome.status, 'unsupported');
  assert.equal(observeResolution(fresh, {
    identity, sourceRevision: fresh.sourceRevision, observationSequence: 20, reason: 'answered',
  }).status, 'wrong-request');
});

test('source revision invalidates old UI commands and rejects old source resolution', () => {
  const initial = createRequest(observation());
  const revised = observePending(initial, observation({
    sourceRevision: 'fixture-revision-2', observationSequence: 11,
  })).state;
  assert.equal(revised.revision, initial.revision + 1);
  assert.equal(beginResponse(revised, command(initial)).outcome.status, 'stale');
  assert.equal(observeResolution(revised, {
    identity, sourceRevision: initial.sourceRevision, observationSequence: 12, reason: 'answered',
  }).status, 'stale');
  assert.equal(needsAttention(revised), true);
});

test('a revision observation cannot permit a second response after a write was reserved', () => {
  const reserved = reserve(createRequest(observation()));
  const revised = observePending(reserved.state, observation({
    sourceRevision: 'fixture-revision-2', observationSequence: 11,
  })).state;
  assert.equal(beginResponse(revised, command(revised, { idempotencyKey: 'new-click' })).outcome.status, 'duplicate');
  assert.equal(recordSubmission(revised, reserved.lease, { status: 'acknowledged' }), revised);
});

test('replays are idempotent, out-of-order source events are stale, and resolution stays terminal', () => {
  const initial = createRequest(observation({ sourceRevision: null }));
  assert.equal(observePending(initial, observation({ sourceRevision: null })).state, initial);
  assert.equal(observePending(initial, observation({ sourceRevision: null, observationSequence: 9 })).status, 'stale');
  const resolved = observeResolution(initial, {
    identity, sourceRevision: null, observationSequence: 12, reason: 'answered',
  }).state;
  assert.equal(observePending(resolved, observation({ sourceRevision: null, observationSequence: 13 })).status, 'stale');
  assert.equal(observePending(resolved, observation({ sourceRevision: 'later-revision', observationSequence: 14 })).status, 'stale');
  assert.equal(observeResolution(resolved, {
    identity, sourceRevision: null, observationSequence: 12, reason: 'answered',
  }).status, 'duplicate');
});

test('idempotency conflicts and uncertain transport outcomes never authorize retry', () => {
  const reserved = reserve(createRequest(observation()));
  assert.equal(beginResponse(reserved.state, command(reserved.state, {
    responseFingerprint: 'different-response',
  })).outcome.status, 'failed');
  const uncertain = recordSubmission(reserved.state, reserved.lease, {
    status: 'uncertain', reason: 'Transport closed after possible write.',
  });
  assert.equal(needsAttention(uncertain), true);
  assert.equal(beginResponse(uncertain, command(uncertain, { idempotencyKey: 'retry-click' })).outcome.status, 'duplicate');
});

test('a proven not-sent failure permits a new explicit attempt but deduplicates its old key', () => {
  const reserved = reserve(createRequest(observation()));
  const failed = recordSubmission(reserved.state, reserved.lease, {
    status: 'not-sent', reason: 'Validation failed before transport write.',
  });
  assert.equal(beginResponse(failed, command(failed)).outcome.status, 'duplicate');
  assert.equal(beginResponse(failed, command(failed, { idempotencyKey: 'new-explicit-click' })).outcome.status, 'ready');
  assert.equal(needsAttention(failed), true);
});

test('forged and duplicate submission callbacks do not alter state', () => {
  const reserved = reserve(createRequest(observation()));
  const forged = { ...reserved.lease, identity: { ...identity, agentId: 'wrong-agent' } };
  assert.equal(recordSubmission(reserved.state, forged, { status: 'acknowledged' }), reserved.state);
  const acknowledged = recordSubmission(reserved.state, reserved.lease, { status: 'acknowledged' });
  assert.equal(recordSubmission(acknowledged, reserved.lease, { status: 'uncertain', reason: 'late' }), acknowledged);
});
test('dispatch guard rejects a lease invalidated between reservation and write', () => {
  const reserved = reserve(createRequest(observation()));
  assert.equal(canDispatch(reserved.state, reserved.lease), true);
  assert.equal(canDispatch(invalidateConnection(reserved.state), reserved.lease), false);
  const revised = observePending(reserved.state, observation({
    sourceRevision: 'fixture-revision-2', observationSequence: 11,
  })).state;
  assert.equal(canDispatch(revised, reserved.lease), false);
  const resolved = observeResolution(reserved.state, {
    identity, sourceRevision: reserved.state.sourceRevision, observationSequence: 11, reason: 'answered',
  }).state;
  assert.equal(canDispatch(resolved, reserved.lease), false);
  const revoked = observePending(reserved.state, observation({
    observationSequence: 11, capability: { supported: false, reason: 'Recipient ownership revoked.' },
  })).state;
  assert.equal(canDispatch(revoked, reserved.lease), false);
});

test('dispatch requires an exact in-flight attempt and supported request schema', () => {
  const initial = createRequest(observation());
  const reserved = reserve(initial);
  assert.equal(canDispatch(initial, reserved.lease), false);
  assert.equal(canDispatch(reserved.state, { ...reserved.lease, responseFingerprint: 'forged' }), false);
  assert.equal(canDispatch(reserved.state, { ...reserved.lease, revision: 99 }), false);
  assert.equal(canDispatch(reserved.state, { ...reserved.lease, identity: { ...identity, connectionId: 'new-connection' } }), false);
  assert.equal(canDispatch({ ...reserved.state, capability: { supported: true, evidenceId: '' } }, reserved.lease), false);
  assert.equal(canDispatch({ ...reserved.state, kind: 'unknown' }, reserved.lease), false);
  const acknowledged = recordSubmission(reserved.state, reserved.lease, { status: 'acknowledged' });
  assert.equal(canDispatch(acknowledged, reserved.lease), false);
});