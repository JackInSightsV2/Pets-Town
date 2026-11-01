import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from '../../client/test-helpers';
import { celebrationPhase, withCelebrationAgents } from './celebration';

test('celebration arrives, works, cheers and leaves on a bounded timeline', () => {
  for (const [elapsed, phase] of [[0, 'entering'], [4999, 'entering'], [5000, 'working'], [9999, 'working'],
    [10000, 'cheering'], [12999, 'cheering'], [13000, 'leaving'], [19999, 'leaving'], [20000, 'idle']] as const)
    assert.equal(celebrationPhase(elapsed), phase);
});

test('only eight synthetic actors join and completion leaves observed evidence unchanged', () => {
  const observed = snapshot(5), before = structuredClone(observed);
  const view = withCelebrationAgents(observed, 'cheering')!;
  assert.equal(view.agents.length, 8);
  assert.equal(new Set(view.agents.map(agent => agent.petAssetId)).size, 8);
  assert.ok(view.agents.every(agent => agent.task?.includes('Simulated')));
  assert.deepEqual(observed, before);
  assert.equal(view.snapshot.lastSeq, 5);
  assert.equal(withCelebrationAgents(observed, 'idle'), null);
});
