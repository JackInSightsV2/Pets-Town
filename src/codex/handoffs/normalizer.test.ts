import assert from 'node:assert/strict';
import test from 'node:test';
import { HandoffNormalizer, type HandoffObservation, type HandoffResult } from './normalizer.js';

// Synthetic source-shaped fixtures, not captured Codex exchanges.
function notification(item: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  return {
    method: 'item/completed',
    params: {
      threadId: 'fixture-sender', turnId: 'fixture-turn', completedAtMs: 1793538000000,
      item: { type: 'subAgentActivity', id: 'fixture-item', kind: 'interacted',
        agentThreadId: 'fixture-recipient', agentPath: '/fixture-recipient', model: null, reasoningEffort: null, ...item },
      ...params,
    },
  };
}
function observation(overrides: Partial<HandoffObservation> = {}): HandoffObservation {
  return { source: 'fixture', sourceNamespace: 'synthetic-daemon', observedAt: '2026-11-01T13:00:00Z',
    delivery: 'live', notification: notification(), ...overrides };
}
function observed(result: HandoffResult) {
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') throw new Error('Expected observed fixture result.');
  return result;
}

test('one sent interaction preserves both participants and exact source correlation', () => {
  const normalizer = new HandoffNormalizer();
  const result = observed(normalizer.observe(observation()));
  assert.equal(result.source, 'fixture');
  assert.deepEqual(result.correlation, { source: 'fixture', sourceNamespace: 'synthetic-daemon',
    threadId: 'fixture-sender', turnId: 'fixture-turn', itemId: 'fixture-item', kind: 'subAgentActivity/interacted' });
  assert.equal(result.handoffs.length, 1);
  assert.deepEqual(result.handoffs[0], {
    handoffId: result.handoffs[0].handoffId, fromAgentId: 'fixture-sender', toAgentId: 'fixture-recipient',
    sourceItemId: 'fixture-item', summary: 'Sent a message.', occurredAt: '2026-11-01T13:00:00Z',
  });
  assert.match(result.handoffs[0].handoffId, /^handoff-v1-[a-f0-9]{64}$/);
});

test('raw transcript fields and display paths are neither retained nor turned into invented dialogue', () => {
  const normalizer = new HandoffNormalizer();
  const result = observed(normalizer.observe(observation({ notification: notification({
    prompt: 'PRIVATE_FIXTURE_TEXT_DO_NOT_RETAIN', agentPath: '/PRIVATE_FIXTURE_PATH',
  }) })));
  assert.equal(result.handoffs[0].summary, 'Sent a message.');
  const retained = JSON.stringify([result, normalizer.checkpoint()]);
  assert.equal(retained.includes('PRIVATE_FIXTURE'), false);
});

test('metadata, parentage, started items and other activity kinds cannot manufacture a meeting', () => {
  const normalizer = new HandoffNormalizer();
  const values: unknown[] = [
    { method: 'thread/status/changed', params: { threadId: 'fixture-sender', parentThreadId: 'fixture-recipient' } },
    { ...notification(), method: 'item/started' },
    { method: 'item/completed', params: { item: { type: 'agentMessage', text: 'I contacted someone' } } },
    null, {}, [],
    ...['spawned', 'closed', 'resumed', 'interrupted', 'waited', 'unknown'].map(kind => notification({ kind })),
  ];
  for (const value of values) assert.deepEqual(normalizer.observe(observation({ notification: value })), { kind: 'ignored', reason: 'not-an-exchange' });
  assert.equal(normalizer.checkpoint().records.length, 0);
});

test('legacy collab tool completion never substitutes for a verified successful send', () => {
  const normalizer = new HandoffNormalizer();
  for (const tool of ['sendInput', 'sendMessage', 'followupTask', 'spawnAgent', 'wait']) {
    for (const status of ['inProgress', 'completed', 'failed', 'interrupted', undefined]) {
      const item = { type: 'collabAgentToolCall', id: 'legacy-call', tool, status,
        senderThreadId: 'fixture-sender', receiverThreadIds: ['fixture-recipient'] };
      assert.deepEqual(normalizer.observe(observation({ notification: notification(item) })), { kind: 'unavailable', reason: 'unverified-exchange-outcome' });
    }
  }
  assert.equal(normalizer.checkpoint().records.length, 0);
});

test('source IDs missing or malformed stay unavailable rather than inferred from a timestamp or path', () => {
  const normalizer = new HandoffNormalizer();
  const values = [
    notification({ id: undefined }), notification({ id: '' }), notification({ agentThreadId: undefined }),
    notification({ agentThreadId: '' }), notification({ agentThreadId: [] }), notification({ agentThreadId: ' ' }),
    notification({}, { threadId: undefined }), notification({}, { turnId: undefined }), notification({}, { turnId: ' ' }),
    { method: 'item/completed', params: {} }, { method: 'item/completed', params: null },
  ];
  for (const value of values) assert.deepEqual(normalizer.observe(observation({ notification: value })), { kind: 'unavailable', reason: 'missing-source-correlation' });
  assert.equal(normalizer.checkpoint().records.length, 0);
});

test('self-target and inconsistent claimed sender fail closed', () => {
  const normalizer = new HandoffNormalizer();
  for (const item of [{ agentThreadId: 'fixture-sender' }, { senderThreadId: 'another-sender' }]) {
    assert.deepEqual(normalizer.observe(observation({ notification: notification(item) })), { kind: 'unavailable', reason: 'inconsistent-participants' });
  }
  assert.equal(normalizer.checkpoint().records.length, 0);
});

test('stable identity is independent of timestamp, display path and reconnect instance', () => {
  const first = observed(new HandoffNormalizer().observe(observation())).handoffs[0];
  const replay = observed(new HandoffNormalizer().observe(observation({
    observedAt: '2026-11-02T17:01:03+00:00',
    notification: notification({ agentPath: '/renamed-path', completedAtMs: 1 }, { completedAtMs: 1 }),
  }))).handoffs[0];
  assert.equal(first.handoffId, replay.handoffId);
  assert.notEqual(first.occurredAt, replay.occurredAt);
});

test('source namespace, turn, item, participants and provenance yield distinct identities', () => {
  const values = [
    observation(), observation({ sourceNamespace: 'another-daemon' }), observation({ source: 'codex' }),
    observation({ notification: notification({ id: 'another-item' }) }),
    observation({ notification: notification({}, { turnId: 'another-turn' }) }),
    observation({ notification: notification({}, { threadId: 'another-sender' }) }),
    observation({ notification: notification({ agentThreadId: 'another-recipient' }) }),
  ];
  // source:codex here tests namespace separation only; this remains synthetic data.
  const ids = values.map(value => observed(new HandoffNormalizer().observe(value)).handoffs[0].handoffId);
  assert.equal(new Set(ids).size, values.length);
});

test('one started/completed pair and its reconnect replay result in exactly one handoff', () => {
  const normalizer = new HandoffNormalizer();
  assert.deepEqual(normalizer.observe(observation({ notification: { ...notification(), method: 'item/started' } })), { kind: 'ignored', reason: 'not-an-exchange' });
  assert.equal(observed(normalizer.observe(observation())).handoffs.length, 1);
  assert.deepEqual(normalizer.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
  const restored = new HandoffNormalizer({ checkpoint: normalizer.checkpoint() });
  assert.deepEqual(restored.observe(observation({ observedAt: '2026-11-01T14:00:00Z' })), { kind: 'ignored', reason: 'duplicate' });
  assert.equal(restored.checkpoint().records.length, 1);
});

test('same pair exchanging again with a different source item is a new handoff', () => {
  const normalizer = new HandoffNormalizer();
  const first = observed(normalizer.observe(observation())).handoffs[0];
  const second = observed(normalizer.observe(observation({ notification: notification({ id: 'second-send' }) }))).handoffs[0];
  assert.notEqual(first.handoffId, second.handoffId);
});

test('reusing one source identity with a different recipient is rejected', () => {
  const normalizer = new HandoffNormalizer();
  normalizer.observe(observation());
  assert.deepEqual(normalizer.observe(observation({ notification: notification({ agentThreadId: 'different-recipient' }) })), { kind: 'unavailable', reason: 'conflicting-source' });
  assert.deepEqual(normalizer.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
});

test('snapshot/history catch-up seeds deduplication without re-enacting a meeting', () => {
  const normalizer = new HandoffNormalizer();
  assert.deepEqual(normalizer.observe(observation({ delivery: 'history' })), { kind: 'ignored', reason: 'history' });
  assert.deepEqual(normalizer.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
  const restored = new HandoffNormalizer({ checkpoint: normalizer.checkpoint() });
  assert.deepEqual(restored.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
  assert.equal(observed(restored.observe(observation({ notification: notification({ id: 'fresh-item' }) }))).handoffs.length, 1);
});

test('capacity exhaustion refuses new exchanges without forgetting earlier IDs', () => {
  const normalizer = new HandoffNormalizer({ maxRecords: 1 });
  normalizer.observe(observation());
  assert.deepEqual(normalizer.observe(observation({ notification: notification({ id: 'new-item' }) })), { kind: 'unavailable', reason: 'capacity-exceeded' });
  assert.deepEqual(normalizer.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
  assert.equal(normalizer.checkpoint().records.length, 1);
});

test('checkpoint copies cannot mutate deduplication state', () => {
  const normalizer = new HandoffNormalizer();
  normalizer.observe(observation());
  const checkpoint = normalizer.checkpoint();
  const restored = new HandoffNormalizer({ checkpoint });
  checkpoint.records[0].toAgentId = 'tampered';
  checkpoint.records[0].itemId = 'tampered';
  assert.deepEqual(normalizer.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
  assert.deepEqual(restored.observe(observation()), { kind: 'ignored', reason: 'duplicate' });
});

test('invalid or conflicting checkpoints reject instead of silently dropping replay protection', () => {
  for (const maxRecords of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => new HandoffNormalizer({ maxRecords }));
  for (const checkpoint of [null, {}, { version: 2, records: [] }, { version: 1, records: [{}] }]) assert.throws(() => new HandoffNormalizer({ checkpoint }));
  const normalizer = new HandoffNormalizer();
  normalizer.observe(observation());
  const record = normalizer.checkpoint().records[0];
  assert.throws(() => new HandoffNormalizer({ checkpoint: { version: 1, records: [record, { ...record, toAgentId: 'different' }] } }));
  assert.throws(() => new HandoffNormalizer({ maxRecords: 1, checkpoint: { version: 1, records: [record, { ...record, itemId: 'second' }] } }));
});

test('unknown provenance, missing receipt context and ambiguous delivery stay unavailable', () => {
  for (const value of [{ source: 'office' }, { sourceNamespace: '' }, { sourceNamespace: ' unstable ' },
    { observedAt: '' }, { observedAt: '2026-11-01' }, { observedAt: 'not-a-date' }, { delivery: 'replay-maybe-live' }]) {
    assert.deepEqual(new HandoffNormalizer().observe({ ...observation(), ...value } as HandoffObservation), { kind: 'unavailable', reason: 'invalid-context' });
  }
});
