import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from '../../client/test-helpers';
import { demoPets } from '../../shared/pets';
import { demoActivity, isDemoAgent, withDemoAgents } from './demo';

test('demo adds eight distinct view-only actors without changing observed evidence', () => {
  const source = snapshot(7); source.petAssets = [{ ...demoPets[0], imageUrl: '/pet-assets/dewey' }];
  const original = structuredClone(source);
  const view = withDemoAgents(source, 0);
  assert.equal(view.agents.length, 8);
  assert.equal(new Set(view.agents.map(agent => agent.petAssetId)).size, 8);
  assert.equal(view.snapshot.agents.length, source.agents.length + 8);
  assert.deepEqual(source, original);
  assert.equal(view.snapshot.lastSeq, 7);
  assert.equal(view.snapshot.source, source.source);
  assert.equal(view.snapshot.petAssets.find(asset => asset.assetId === source.petAssets[0]?.assetId), source.petAssets[0]);
  assert.ok(view.agents.every(agent => isDemoAgent(agent.agentId) && agent.role === 'Simulated teammate' && agent.recentActivity[0].source === 'fixture'));
  assert.equal(demoActivity('real-agent', 0), null);
});

test('demo activities rotate while identities stay stable, even without an observer', () => {
  const first = withDemoAgents(null, 0), next = withDemoAgents(null, 1);
  assert.deepEqual(first.agents.map(agent => agent.agentId), next.agents.map(agent => agent.agentId));
  assert.ok(first.agents.every((agent, index) => agent.task !== next.agents[index].task));
  assert.ok(first.agents.some(agent => agent.runtimeState === 'idle'));
  assert.equal(first.snapshot.latestTurns, undefined);
});
