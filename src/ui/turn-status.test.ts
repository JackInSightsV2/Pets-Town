import assert from 'node:assert/strict';
import test from 'node:test';
import { agent, snapshot, time } from '../client/test-helpers';
import { observedStatusLabel } from './view-model';
import type { TurnLifecycleObservation } from '../shared/turn-lifecycle';

test('verified current turn supplies a status label without rewriting unknown runtime metadata', () => {
  const current = snapshot();
  const pet = { ...agent(), runtimeState: 'unknown' as const };
  current.agents = [pet];
  const turn: TurnLifecycleObservation = { agentId: pet.agentId, turnId: `turn-v1-${'a'.repeat(64)}`,
    sourceEventId: `turn-event-v1-${'b'.repeat(64)}`, source: 'fixture', delivery: 'live', status: 'started', occurredAt: time, startedAt: 1 };
  assert.equal(observedStatusLabel(pet, current), 'State unavailable');
  current.latestTurns = [turn];
  assert.equal(observedStatusLabel(pet, current), 'Turn in progress');
  assert.equal(pet.runtimeState, 'unknown');
  for (const [status, label] of [['succeeded', 'Turn finished'], ['failed', 'Turn failed'], ['interrupted', 'Turn interrupted']] as const) {
    current.latestTurns = [{ ...turn, status }];
    assert.equal(observedStatusLabel(pet, current), label);
  }
  current.latestTurns = [{ ...turn, source: 'codex' }];
  assert.equal(observedStatusLabel(pet, current), 'State unavailable');
  current.latestTurns = [{ ...turn, agentId: 'another-pet' }];
  assert.equal(observedStatusLabel(pet, current), 'State unavailable');
});

test('explicit runtime waiting, error and closed status remain authoritative labels', () => {
  const current = snapshot();
  current.latestTurns = [{ agentId: 'main', turnId: `turn-v1-${'a'.repeat(64)}`, sourceEventId: `turn-event-v1-${'b'.repeat(64)}`,
    source: 'fixture', delivery: 'live', status: 'started', occurredAt: time, startedAt: 1 }];
  for (const [runtimeState, label] of [['waiting-for-input', 'Waiting for input'], ['waiting-for-approval', 'Waiting for approval'],
    ['error', 'Agent error'], ['closed', 'Session closed']] as const) {
    assert.equal(observedStatusLabel({ ...agent(), runtimeState }, current), label);
  }
});
