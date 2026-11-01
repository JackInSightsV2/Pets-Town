import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertLatestTurn, type TurnLifecycleObservation } from '../shared/turn-lifecycle.js';
import { validEvent } from '../server/validation.js';
import { agent, event, snapshot, time } from './test-helpers.js';
import { isOfficeEvent, isOfficeSnapshot } from './validation.js';

function observation(overrides: Partial<TurnLifecycleObservation> = {}): TurnLifecycleObservation {
  return { agentId: 'main', turnId: `turn-v1-${'a'.repeat(64)}`, sourceEventId: `turn-event-v1-${'b'.repeat(64)}`,
    status: 'started', source: 'fixture', delivery: 'live', occurredAt: time, startedAt: 1, ...overrides };
}

test('legacy snapshots and events remain valid when lifecycle evidence is omitted', () => {
  assert.equal(isOfficeSnapshot(snapshot()), true);
  assert.equal(isOfficeSnapshot({ ...snapshot(), latestTurns: [] }), true);
  const oldCompletion = event(1, 'agent.work.completed', { sourceItemId: 'synthetic-work-item' });
  assert.equal(isOfficeEvent(oldCompletion), true);
  assert.equal(validEvent(oldCompletion), true);
});

test('snapshots accept one correlated latest turn per agent for each supported source', () => {
  for (const source of ['codex', 'fixture'] as const) {
    assert.equal(isOfficeSnapshot({ ...snapshot(), source, agents: [agent(), agent('child')],
      latestTurns: [observation({ source, delivery: 'history' }), observation({ source, agentId: 'child',
        turnId: `turn-v1-${'c'.repeat(64)}`, sourceEventId: `turn-event-v1-${'d'.repeat(64)}`, status: 'interrupted' })] }), true);
  }
});

test('snapshots reject duplicate turn owners, unknown agents, source mismatches and malformed evidence', () => {
  const invalid = [
    null,
    {},
    [null],
    [observation(), observation()],
    [observation(), observation({ turnId: `turn-v1-${'c'.repeat(64)}`, sourceEventId: `turn-event-v1-${'d'.repeat(64)}` })],
    [observation({ agentId: 'missing' })],
    [observation({ source: 'codex' })],
    [{ ...observation(), status: 'unknown' }],
    [{ ...observation(), turnId: 'raw-turn-id' }],
    [{ ...observation(), sourceEventId: 'raw-event-id' }],
  ];
  for (const latestTurns of invalid) assert.equal(isOfficeSnapshot({ ...snapshot(), latestTurns }), false);
});

test('client and server accept correlated lifecycle events without converting their outcome', () => {
  for (const source of ['codex', 'fixture'] as const) {
    for (const status of ['started', 'succeeded', 'failed', 'interrupted'] as const) {
      const input = event(1, 'agent.turn.observed', { observation: observation({ source, status }) }, { source });
      const original = structuredClone(input);
      assert.equal(isOfficeEvent(input), true);
      assert.equal(validEvent(input), true);
      assert.deepEqual(input, original);
    }
  }
});

test('client and server reject lifecycle envelope correlation failures', () => {
  const good = event(1, 'agent.turn.observed', { observation: observation() });
  const invalid = [
    { ...good, agentId: 'other' },
    { ...good, agentId: null },
    { ...good, source: 'codex' },
    { ...good, source: 'office' },
    { ...good, data: {} },
    { ...good, data: { observation: null } },
    { ...good, data: { observation: { ...observation(), agentId: '' } } },
    { ...good, data: { observation: { ...observation(), source: 'office' } } },
    { ...good, data: { observation: { ...observation(), status: 'completed' } } },
    { ...good, data: { observation: { ...observation(), delivery: 'replayed' } } },
    { ...good, data: { observation: { ...observation(), occurredAt: 'invalid-time' } } },
    { ...good, data: { observation: { ...observation(), startedAt: 1.5 } } },
    { ...good, data: { observation: Object.assign([], observation()) } },
  ];
  for (const input of invalid) {
    assert.equal(isOfficeEvent(input), false);
    assert.equal(validEvent(input), false);
  }
});

test('latest-turn updates preserve evidence for duplicate, regressing and conflicting observations', () => {
  const current = observation({ status: 'succeeded', startedAt: 10 });
  const existing = Object.freeze([Object.freeze(current)]);
  for (const incoming of [
    { ...current, occurredAt: '2026-11-01T14:00:00.000Z' },
    observation({ status: 'started', sourceEventId: `turn-event-v1-${'c'.repeat(64)}`, startedAt: 10 }),
    observation({ status: 'failed', sourceEventId: `turn-event-v1-${'d'.repeat(64)}`, startedAt: 10 }),
    observation({ status: 'interrupted', sourceEventId: `turn-event-v1-${'e'.repeat(64)}`, startedAt: 10 }),
    observation({ turnId: `turn-v1-${'f'.repeat(64)}`, sourceEventId: `turn-event-v1-${'f'.repeat(64)}`, startedAt: 9 }),
  ]) assert.equal(upsertLatestTurn(existing, incoming), existing);
});

test('latest-turn updates accept progress and newer turns while preserving other agents', () => {
  const child = observation({ agentId: 'child' });
  const started = observation({ startedAt: 10 });
  const existing = Object.freeze([Object.freeze(child), Object.freeze(started)]);
  const succeeded = observation({ status: 'succeeded', sourceEventId: `turn-event-v1-${'c'.repeat(64)}`, startedAt: 10 });
  const completed = upsertLatestTurn(existing, succeeded);
  assert.deepEqual(completed, [child, succeeded]);
  assert.deepEqual(existing, [child, started]);
  const nextTurn = observation({ turnId: `turn-v1-${'d'.repeat(64)}`, sourceEventId: `turn-event-v1-${'e'.repeat(64)}`, startedAt: 11 });
  assert.deepEqual(upsertLatestTurn(completed, nextTurn), [child, nextTurn]);
  assert.deepEqual(upsertLatestTurn(undefined, started), [started]);
});

test('different turns with missing or equal source start times cannot replace current evidence', () => {
  for (const [currentStart, incomingStart] of [[null, null], [null, 11], [10, null], [10, 10]] as const) {
    const existing = Object.freeze([observation({ startedAt: currentStart })]);
    const incoming = observation({ turnId: `turn-v1-${'c'.repeat(64)}`, sourceEventId: `turn-event-v1-${'d'.repeat(64)}`,
      status: 'succeeded', startedAt: incomingStart, occurredAt: '2026-11-01T14:00:00.000Z' });
    assert.equal(upsertLatestTurn(existing, incoming), existing);
  }
});

test('delayed old-turn observations cannot replace a newer turn', () => {
  const oldTurn = observation({ startedAt: 10 });
  const newTurn = observation({ turnId: `turn-v1-${'c'.repeat(64)}`, sourceEventId: `turn-event-v1-${'d'.repeat(64)}`, startedAt: 11 });
  const latest = upsertLatestTurn([oldTurn], newTurn);
  for (const startedAt of [10, null]) {
    const delayed = { ...oldTurn, status: 'succeeded' as const, sourceEventId: `turn-event-v1-${'e'.repeat(64)}`,
      startedAt, occurredAt: '2026-11-01T14:00:00.000Z' };
    assert.equal(upsertLatestTurn(latest, delayed), latest);
  }
  assert.deepEqual(latest, [newTurn]);
});

test('same-turn terminal progress remains valid without source start times', () => {
  const started = observation({ startedAt: null });
  const succeeded = { ...started, status: 'succeeded' as const, sourceEventId: `turn-event-v1-${'c'.repeat(64)}` };
  assert.deepEqual(upsertLatestTurn([started], succeeded), [succeeded]);
});

test('same-turn terminal updates retain an already observed start time when omitted', () => {
  const started = observation({ startedAt: 100 });
  const succeeded = { ...started, status: 'succeeded' as const, sourceEventId: `turn-event-v1-${'c'.repeat(64)}`, startedAt: null };
  const completed = upsertLatestTurn([started], succeeded);
  assert.deepEqual(completed, [{ ...succeeded, startedAt: 100 }]);
  assert.equal(succeeded.startedAt, null);
  const nextTurn = observation({ turnId: `turn-v1-${'d'.repeat(64)}`, sourceEventId: `turn-event-v1-${'e'.repeat(64)}`, startedAt: 101 });
  assert.deepEqual(upsertLatestTurn(completed, nextTurn), [nextTurn]);
});
