import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTurnLifecycle, type TurnLifecycleInput } from './normalizer.js';

const input = (overrides: Partial<TurnLifecycleInput> = {}): TurnLifecycleInput => ({
  source: 'fixture', sourceNamespace: 'synthetic-source', threadId: 'synthetic-thread', agentId: 'agent-a',
  observedAt: '2026-01-01T00:00:00.000Z', delivery: 'live', format: 'notification',
  value: { method: 'turn/started', params: { threadId: 'synthetic-thread', turn: { id: 'turn-a', status: 'inProgress', startedAt: 100 } } }, ...overrides,
});
const notification = (status: unknown, extra: Record<string, unknown> = {}, method = 'turn/completed') => ({
  method, params: { threadId: 'synthetic-thread', turn: { id: 'turn-a', status, ...extra } },
});

test('explicit projected turn statuses establish all four lifecycle outcomes', () => {
  for (const [status, expected] of [['inProgress', 'started'], ['completed', 'succeeded'], ['failed', 'failed'], ['interrupted', 'interrupted']]) {
    const result = normalizeTurnLifecycle(input({ value: notification(status, {}, status === 'inProgress' ? 'turn/started' : 'turn/completed') }));
    assert.equal(result.kind, 'observed');
    if (result.kind === 'observed') assert.equal(result.observation.status, expected);
  }
});

test('notification name alone, runtime metadata, command failure and raw rollout completion do not imply success', () => {
  for (const value of [notification(undefined), notification('inProgress'), notification('unknown'), notification('__proto__'),
    { method: 'thread/status/changed', params: { status: { type: 'idle' } } },
    { method: 'item/completed', params: { item: { type: 'commandExecution', status: 'failed' } } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a' } },
    notification('failed', {}, 'turn/started'), notification('completed', { error: { message: 'synthetic error' } })]) {
    assert.notEqual(normalizeTurnLifecycle(input({ value })).kind, 'observed');
  }
});

test('missing or mismatched thread/turn correlation and invalid context fail closed', () => {
  for (const value of [{ method: 'turn/completed', params: { threadId: 'other-thread', turn: { id: 'turn-a', status: 'completed' } } },
    { method: 'turn/completed', params: { threadId: 'synthetic-thread', turn: { status: 'completed' } } }]) {
    assert.deepEqual(normalizeTurnLifecycle(input({ value })), { kind: 'unavailable', reason: 'missing-correlation' });
  }
  assert.equal(normalizeTurnLifecycle(input({ observedAt: 'not-a-date' })).kind, 'unavailable');
  assert.equal(normalizeTurnLifecycle(input({ sourceNamespace: '' })).kind, 'unavailable');
});

test('history terminal status requires explicit terminal timestamp; inferred completed is unavailable', () => {
  for (const status of ['completed', 'failed', 'interrupted']) {
    const value = { threadId: 'synthetic-thread', turn: { id: 'turn-a', status, startedAt: 100 } };
    assert.equal(normalizeTurnLifecycle(input({ format: 'history-turn', delivery: 'history', value })).kind, 'unavailable');
    const result = normalizeTurnLifecycle(input({ format: 'history-turn', delivery: 'history', value: { ...value, turn: { ...value.turn, completedAt: 110 } } }));
    assert.equal(result.kind, 'observed');
    if (result.kind === 'observed') assert.equal(result.observation.delivery, 'history');
  }
});

test('history start requires an independently verified current active thread and explicit start', () => {
  const history = { format: 'history-turn' as const, delivery: 'history' as const,
    value: { threadId: 'synthetic-thread', turn: { id: 'turn-a', status: 'inProgress', startedAt: 100 } } };
  assert.equal(normalizeTurnLifecycle(input(history)).kind, 'unavailable');
  assert.equal(normalizeTurnLifecycle(input({ ...history, currentThreadActive: true })).kind, 'observed');
  assert.equal(normalizeTurnLifecycle(input({ ...history, currentThreadActive: true,
    value: { threadId: 'synthetic-thread', turn: { id: 'turn-a', status: 'inProgress' } } })).kind, 'unavailable');
});

test('invalid or reversed source timestamps cannot establish history outcome', () => {
  for (const completedAt of [99, '110', 110.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -1]) assert.equal(normalizeTurnLifecycle(input({
    format: 'history-turn', value: { threadId: 'synthetic-thread', turn: { id: 'turn-a', status: 'completed', startedAt: 100, completedAt } },
  })).kind, 'unavailable');
});

test('stable opaque identity ignores receipt time and strips raw identifiers, errors and transcript', () => {
  const value = notification('failed', { error: { message: 'synthetic-secret' }, items: [{ text: 'synthetic-prompt' }], privatePath: 'synthetic/path' });
  const a = normalizeTurnLifecycle(input({ value }));
  const b = normalizeTurnLifecycle(input({ value, observedAt: '2026-01-02T00:00:00Z', delivery: 'history' }));
  assert.equal(a.kind, 'observed'); assert.equal(b.kind, 'observed');
  if (a.kind !== 'observed' || b.kind !== 'observed') return;
  assert.equal(a.observation.sourceEventId, b.observation.sourceEventId);
  assert.equal(a.observation.turnId, b.observation.turnId);
  for (const privateText of ['synthetic-secret', 'synthetic-prompt', 'synthetic/path', 'synthetic-thread', 'synthetic-source', 'turn-a']) {
    assert.equal(JSON.stringify(a.observation).includes(privateText), false);
  }
  const other = normalizeTurnLifecycle(input({ value, sourceNamespace: 'other-source' }));
  if (other.kind === 'observed') assert.notEqual(a.observation.turnId, other.observation.turnId);
});
