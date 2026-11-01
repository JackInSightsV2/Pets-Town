import test from 'node:test';
import assert from 'node:assert/strict';
import { event, snapshot, time } from '../client/test-helpers.js';
import { projectEvents } from './events.js';

const cursor = { bridgeEpoch: 'epoch-a', lastSeq: 0, source: 'fixture' as const };
const turn = { agentId: 'main', turnId: `turn-v1-${'a'.repeat(64)}`, sourceEventId: `turn-event-v1-${'b'.repeat(64)}`,
  status: 'started' as const, source: 'fixture' as const, delivery: 'live' as const, occurredAt: time, startedAt: 1 };

test('continuous scoped observations preserve ordered source evidence', () => {
  const current = snapshot(4);
  const source = [event(1, 'agent.upserted', { agent: current.agents[0] }),
    event(2, 'connection.changed', { connection: current.connection }, { agentId: null }),
    event(3, 'agent.turn.observed', { observation: turn }),
    event(4, 'agent.turn.observed', { observation: { ...turn, sourceEventId: `turn-event-v1-${'c'.repeat(64)}`, status: 'succeeded' } })];
  const result = projectEvents(source, current, cursor)!;
  assert.deepEqual(result.map(row => row.seq), [1, 2, 3, 4]);
  assert.deepEqual(result[2].data, { observation: turn });
});

test('missing, unsafe, source changed, and reconnect evidence requires a baseline', () => {
  const current = snapshot(1);
  assert.equal(projectEvents(null, current, cursor), null);
  assert.equal(projectEvents([], current, cursor), null);
  assert.equal(projectEvents([event(1, 'agent.state.changed', { runtimeState: 'idle' }, { agentId: 'secret' })], current, cursor), null);
  assert.equal(projectEvents([event(1, 'connection.changed', { connection: { ...current.connection, status: 'reconnecting' } })], current, cursor), null);
  assert.equal(projectEvents([event(1, 'agent.turn.observed', { observation: turn })], current, { ...cursor, source: 'codex' }), null);
  assert.equal(projectEvents([event(1, 'agent.turn.observed', { observation: turn })], { ...current, connection: { ...current.connection, status: 'reconnecting' } }, cursor), null);
  assert.equal(projectEvents([event(1, 'agent.turn.observed', { observation: turn })], snapshot(1, 'new-epoch'), cursor), null);
});
