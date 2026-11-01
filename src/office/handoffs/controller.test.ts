import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, type OfficeAgent, type OfficeEvent, type OfficeHandoff } from '../../shared/contract.js';
import { createHandoffController } from './controller.js';

const at = '2026-11-01T13:00:00Z';
const agent = (agentId: string): OfficeAgent => ({
  agentId, parentAgentId: null, projectId: 'fixture-project', displayName: agentId,
  role: null, task: null, runtimeState: 'working', activityKind: 'unknown',
  lastObservedAt: at, pendingRequestIds: [], petAssetId: null, recentActivity: [],
});
const handoff: OfficeHandoff = { handoffId: 'synthetic-h1', fromAgentId: 'a', toAgentId: 'b',
  summary: 'Sent a message.', occurredAt: at, sourceItemId: 'synthetic-item' };
function setup() {
  const snapshot = emptySnapshot('fixture-bridge');
  snapshot.source = 'fixture';
  snapshot.agents = ['a', 'b'].map(agent);
  snapshot.capabilities.observeHandoffs = { supported: true, reason: null };
  snapshot.presentation = { state: 'live', canSkip: false };
  const controller = createHandoffController();
  controller.applySnapshot(snapshot, ['a', 'b']);
  return { controller, snapshot };
}
function observed(seq = 1): OfficeEvent {
  return { protocolVersion: 1, bridgeEpoch: 'fixture-bridge', seq, eventId: 'synthetic-e' + seq,
    occurredAt: at, source: 'fixture', type: 'handoff.observed', agentId: 'a', data: { handoff } };
}

test('synthetic boundary preserves exact pair and source ID, suppressing replay and resnapshot meetings', () => {
  const { controller } = setup();
  assert.equal(controller.applyEvent(observed()), 'applied');
  const first = controller.getState().active!;
  assert.deepEqual(first.handoff, handoff);
  assert.equal(controller.applyEvent(observed()), 'ignored');
  controller.complete(first.token);
  controller.applyEvent(observed(2));
  assert.equal(controller.getState().active, null);
  const current = controller.store.getState().snapshot!;
  controller.applySnapshot(current, ['a', 'b']);
  assert.equal(controller.getState().active, null);
  assert.equal(controller.complete(first.token), false);
});

test('snapshot history seeds IDs and does not animate; a gap requires resnapshot', () => {
  const { controller, snapshot } = setup();
  snapshot.recentHandoffs = [handoff];
  controller.applySnapshot(snapshot, ['a', 'b']);
  controller.applyEvent(observed());
  assert.equal(controller.getState().active, null);
  assert.equal(controller.applyEvent(observed(3)), 'snapshot-required');
  assert.equal(controller.getState().active, null);
});

test('unavailable capability and inconsistent sender cannot animate', () => {
  const { controller, snapshot } = setup();
  snapshot.capabilities.observeHandoffs = { supported: false, reason: 'Metadata only.' };
  controller.applySnapshot(snapshot, ['a', 'b']);
  assert.equal(controller.applyEvent(observed()), 'unavailable');
  assert.equal(controller.getState().active, null);
  const second = setup().controller;
  const wrong = observed(); wrong.agentId = 'b';
  assert.equal(second.applyEvent(wrong), 'unavailable');
  assert.equal(second.getState().active, null);
});

test('failure restores current truth and presentation reset invalidates callbacks', () => {
  const { controller } = setup();
  controller.applyEvent(observed());
  const token = controller.getState().active!.token;
  controller.drainEffects();
  controller.applyEvent({ protocolVersion: 1, bridgeEpoch: 'fixture-bridge', seq: 2,
    eventId: 'failure', occurredAt: at, source: 'fixture', agentId: 'a',
    type: 'agent.state.changed', data: { runtimeState: 'error' } });
  const ended = controller.drainEffects().find(effect => effect.type === 'end');
  assert.equal(ended?.type, 'end');
  if (ended?.type === 'end') assert.equal(ended.agents.find(a => a.agentId === 'a')?.runtimeState, 'error');
  controller.applyEvent({ protocolVersion: 1, bridgeEpoch: 'fixture-bridge', seq: 3,
    eventId: 'reset', occurredAt: at, source: 'office', agentId: null,
    type: 'presentation.changed', data: { officeSessionId: 'new-office', state: 'ready', canSkip: false } });
  assert.equal(controller.complete(token), false);
  assert.equal(controller.store.getState().snapshot!.agents[0].runtimeState, 'error');
});
