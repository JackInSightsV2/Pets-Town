import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { beginResponse, createRequest, invalidateConnection, needsAttention, observePending, observeResolution, recordSubmission, requestKey, sameRequest, type PendingObservation, type ResponseCommand } from './state.js';

const identity = { daemonId: 'daemon', connectionId: 'connection', agentId: 'agent', sourceRequestId: 7 };
const pending = (overrides: Partial<PendingObservation> = {}): PendingObservation => ({ identity, sourceRevision: 'r1', observationSequence: 10, kind: 'user-input', capability: { supported: true, evidenceId: 'fixture-only' }, ...overrides });
const command = (state: ReturnType<typeof createRequest>, overrides: Partial<ResponseCommand> = {}): ResponseCommand => ({ identity, expectedRevision: state.revision, idempotencyKey: 'click', responseFingerprint: 'answer-a', kind: 'user-input', ...overrides });
const resolve = (state: ReturnType<typeof createRequest>, reason: 'answered' | 'cancelled' = 'answered', sequence = 11) => observeResolution(state, { identity, sourceRevision: 'r1', observationSequence: sequence, reason });

test('duplicate clicks never reserve another submission; changing payload under the key fails', () => {
  const initial = createRequest(pending());
  const first = beginResponse(initial, command(initial));
  assert.equal(first.outcome.status, 'ready');
  assert.equal(initial.attempts.length, 0);
  assert.equal(beginResponse(first.state, command(first.state)).outcome.status, 'duplicate');
  assert.equal(beginResponse(first.state, command(first.state, { idempotencyKey: 'second-click' })).outcome.status, 'duplicate');
  assert.equal(beginResponse(first.state, command(first.state, { responseFingerprint: 'different' })).outcome.status, 'failed');
  assert.equal(first.state.attempts.length, 1);
});

test('acknowledgement keeps attention until matching source resolution, including cancellation', () => {
  const initial = createRequest(pending());
  const first = beginResponse(initial, command(initial));
  assert.equal(first.outcome.status, 'ready');
  if (first.outcome.status !== 'ready') return;
  const acknowledged = recordSubmission(first.state, first.outcome.lease, { status: 'acknowledged' });
  assert.equal(needsAttention(acknowledged), true);
  const cancelled = resolve(acknowledged, 'cancelled');
  assert.equal(cancelled.status, 'applied');
  assert.equal(cancelled.state.resolution, 'cancelled');
  assert.equal(needsAttention(cancelled.state), false);
  assert.equal(beginResponse(cancelled.state, command(cancelled.state)).outcome.status, 'already-resolved');
});

test('resolution elsewhere wins and wrong agent or numeric/string IDs never match', () => {
  const initial = createRequest(pending());
  const wrong = { ...identity, agentId: 'other' };
  assert.equal(observeResolution(initial, { identity: wrong, sourceRevision: 'r1', observationSequence: 11, reason: 'answered' }).status, 'wrong-request');
  assert.equal(beginResponse(initial, command(initial, { identity: wrong })).outcome.status, 'stale');
  const stringId = { ...identity, sourceRequestId: '7' };
  assert.equal(sameRequest(identity, stringId), false);
  assert.notEqual(requestKey(identity), requestKey(stringId));
  assert.equal(observeResolution(initial, { identity: stringId, sourceRevision: 'r1', observationSequence: 11, reason: 'answered' }).status, 'wrong-request');
  const resolved = resolve(initial).state;
  assert.equal(beginResponse(resolved, command(resolved)).outcome.status, 'already-resolved');
});

test('out-of-order events and replay do not resurrect resolved attention', () => {
  const initial = createRequest(pending());
  assert.equal(resolve(initial, 'answered', 9).status, 'stale');
  assert.equal(needsAttention(initial), true);
  const resolved = resolve(initial).state;
  assert.equal(observePending(resolved, pending({ observationSequence: 12 })).status, 'stale');
  assert.equal(needsAttention(resolved), false);
});

test('disconnect invalidates old ownership and unsupported replies cannot reserve a lease', () => {
  const initial = createRequest(pending());
  const disconnected = invalidateConnection(initial);
  assert.equal(needsAttention(disconnected), true);
  assert.equal(beginResponse(disconnected, command(initial)).outcome.status, 'stale');
  assert.equal(observePending(disconnected, pending({ observationSequence: 11 })).status, 'stale');
  const otherConnection = { ...identity, connectionId: 'new-connection' };
  assert.equal(observePending(disconnected, pending({ identity: otherConnection, observationSequence: 11 })).status, 'wrong-request');
  const unsupported = createRequest(pending({ capability: { supported: false, reason: 'ownership unproven' } }));
  assert.equal(beginResponse(unsupported, command(unsupported)).outcome.status, 'unsupported');
  assert.equal(unsupported.attempts.length, 0);
});

test('stale revision cannot submit; ambiguous delivery cannot be retried with another key', () => {
  const initial = createRequest(pending());
  const updated = observePending(initial, pending({ sourceRevision: 'r2', observationSequence: 11 })).state;
  assert.equal(beginResponse(updated, command(initial)).outcome.status, 'stale');
  const first = beginResponse(initial, command(initial));
  assert.equal(first.outcome.status, 'ready');
  if (first.outcome.status !== 'ready') return;
  const uncertain = recordSubmission(first.state, first.outcome.lease, { status: 'uncertain', reason: 'connection dropped' });
  assert.equal(beginResponse(uncertain, command(uncertain, { idempotencyKey: 'retry' })).outcome.status, 'duplicate');
  assert.equal(needsAttention(uncertain), true);
});
