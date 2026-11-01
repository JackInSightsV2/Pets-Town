import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ActivityNormalizer, type ActivityObservation } from './normalizer.js';

const input = (delivery: 'live' | 'history' = 'live'): ActivityObservation => ({
  source: 'codex', sourceNamespace: 'private-namespace', threadId: 'private-thread', turnId: 'private-turn',
  agentId: 'public-agent', observedAt: '2026-11-01T12:00:00Z', delivery,
  event: { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'private-thread', turn_id: 'private-turn', item: {
    type: 'CommandExecution', status: 'completed', id: 'private-item', command: 'SECRET', output: 'SECRET', arguments: 'SECRET', path: 'SECRET',
  } } },
});

test('emits fixed activity with no source details or private record contents', () => {
  const normalizer = new ActivityNormalizer();
  const result = normalizer.observe(input());
  assert.equal(result.kind, 'observed');
  if (result.kind === 'observed') assert.deepEqual([result.activity.kind, result.activity.summary, result.activity.sourceItemId], ['running-command', 'Ran a command.', null]);
  const serialized = JSON.stringify([result, normalizer.checkpoint()]);
  for (const secret of ['SECRET', 'private-namespace', 'private-thread', 'private-turn', 'private-item']) assert.equal(serialized.includes(secret), false);
});

test('history seeds deduplication across reconnect and preserves stable keys', () => {
  const normalizer = new ActivityNormalizer();
  assert.deepEqual(normalizer.observe(input('history')), { kind: 'ignored', reason: 'history' });
  const restored = new ActivityNormalizer({ checkpoint: normalizer.checkpoint() });
  assert.deepEqual(restored.observe(input()), { kind: 'ignored', reason: 'duplicate' });
  const differentTurn = input();
  differentTurn.turnId = 'another-turn';
  differentTurn.event = { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'private-thread', turn_id: 'another-turn', item: { type: 'CommandExecution', status: 'failed', id: 'private-item' } } };
  assert.equal(restored.observe(differentTurn).kind, 'observed');
  assert.deepEqual(restored.observe({ ...input(), agentId: 'other-agent' }), { kind: 'unavailable', reason: 'conflicting-source' });
});

test('only completed command items with matching app-server context are accepted', () => {
  const normalizer = new ActivityNormalizer();
  for (const event of [null, { method: 'item/started', params: { item: { type: 'commandExecution', id: 'id' } } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', id: 'id' } } },
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'other', turn_id: 'private-turn', item: { type: 'CommandExecution', status: 'completed', id: 'id' } } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'private-turn', item: { type: 'CommandExecution', status: 'completed', id: 'id' } } },
    { method: 'item/completed', params: { threadId: 'other', turnId: 'private-turn', item: { type: 'commandExecution', id: 'id' } } }]) {
    assert.equal(normalizer.observe({ ...input(), event }).kind, 'ignored');
  }
  assert.equal(normalizer.observe({ ...input(), event: { method: 'item/completed', params: { threadId: 'private-thread', turnId: 'private-turn', item: { type: 'commandExecution', status: 'completed', id: 'id' } } } }).kind, 'observed');
});

test('capacity and malformed checkpoints fail closed', () => {
  const normalizer = new ActivityNormalizer({ maxRecords: 1 });
  normalizer.observe(input());
  const next = input();
  next.event = { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'private-thread', turn_id: 'private-turn', item: { type: 'CommandExecution', status: 'failed', id: 'other' } } };
  assert.deepEqual(normalizer.observe(next), { kind: 'unavailable', reason: 'capacity-exceeded' });
  assert.throws(() => new ActivityNormalizer({ checkpoint: { version: 1, records: [{ key: 'raw', agent: 'raw' }] } }));
});
