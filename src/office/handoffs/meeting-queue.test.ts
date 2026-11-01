import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfficeAgent, OfficeHandoff, RuntimeState } from '../../shared/contract';
import { createMeetingQueue } from './meeting-queue';

const agent = (agentId: string, runtimeState: RuntimeState = 'working', parentAgentId: string | null = null): OfficeAgent => ({
  agentId, parentAgentId, projectId: 'synthetic-project', displayName: agentId, role: null, task: null,
  runtimeState, activityKind: 'editing', lastObservedAt: null, pendingRequestIds: [], petAssetId: null, recentActivity: [],
});
const handoff = (handoffId: string, fromAgentId = 'a', toAgentId = 'b'): OfficeHandoff => ({
  handoffId, fromAgentId, toAgentId, summary: 'Synthetic completed message exchange.',
  occurredAt: '2026-11-01T12:00:00.000Z', sourceItemId: 'synthetic-item-' + handoffId,
});
const cohort = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => agent(id));
function ready(maxQueued = 8) {
  const queue = createMeetingQueue({ maxQueued });
  queue.setAgents(cohort, cohort.map(a => a.agentId));
  queue.setPresentation('live');
  return queue;
}

test('starts the correct pair once and ignores duplicate delivery', () => {
  const queue = ready();
  assert.equal(queue.observe(handoff('one')).status, 'started');
  assert.equal(queue.observe(handoff('one')).status, 'duplicate');
  assert.deepEqual(queue.getState().active?.handoff, handoff('one'));
  const effects = queue.drainEffects();
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'start');
  assert.equal(queue.getState().active?.handoff.summary, 'Synthetic completed message exchange.');
});

test('serializes overlapping pairs and reserves one queued slot per pet', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  assert.equal(queue.observe(handoff('ac', 'a', 'c')).status, 'queued');
  assert.equal(queue.observe(handoff('bd', 'b', 'd')).status, 'queued');
  assert.deepEqual(queue.observe(handoff('ae', 'a', 'e')),
    { status: 'dropped', reason: 'participant-already-queued' });
  assert.equal(queue.getState().queued.length, 2);
  const first = queue.getState().active!;
  assert.equal(queue.complete(first.token), true);
  assert.equal(queue.getState().active?.handoff.handoffId, 'ac');
  assert.equal(queue.complete(first.token), false);
  queue.complete(queue.getState().active!.token);
  assert.equal(queue.getState().active?.handoff.handoffId, 'bd');
  queue.complete(queue.getState().active!.token);
  assert.equal(queue.getState().active, null);
  assert.equal(queue.observe(handoff('ae', 'a', 'e')).status, 'duplicate');
});

test('capacity counts queued meetings and overflow drops newest permanently', () => {
  const queue = ready(1);
  queue.observe(handoff('ab'));
  queue.observe(handoff('cd', 'c', 'd'));
  assert.deepEqual(queue.observe(handoff('ef', 'e', 'f')), { status: 'dropped', reason: 'queue-full' });
  assert.equal(queue.getState().dropped, 1);
  queue.complete(queue.getState().active!.token);
  queue.complete(queue.getState().active!.token);
  assert.equal(queue.observe(handoff('ef', 'e', 'f')).status, 'duplicate');
  assert.equal(queue.getState().active, null);
});

test('zero waiting capacity still permits a free visible cooler', () => {
  const queue = ready(0);
  assert.equal(queue.observe(handoff('ab')).status, 'started');
  assert.deepEqual(queue.observe(handoff('cd', 'c', 'd')), { status: 'dropped', reason: 'queue-full' });
  assert.throws(() => createMeetingQueue({ maxQueued: -1 }), RangeError);
  assert.throws(() => createMeetingQueue({ maxQueued: 1.5 }), RangeError);
});

test('hidden participants receive an identifiable group signal and wait for expansion', () => {
  const queue = createMeetingQueue();
  const agents = [agent('a'), agent('b', 'working', 'a'), agent('c'), agent('d')];
  queue.setAgents(agents, ['a', 'c', 'd']);
  queue.setPresentation('live');
  assert.equal(queue.observe(handoff('ab')).status, 'hidden');
  assert.equal(queue.getState().active, null);
  assert.deepEqual(queue.getState().hiddenSignals[0].hiddenAgentIds, ['b']);
  assert.deepEqual(queue.getState().hiddenSignals[0].groupAgentIds, ['a']);
  assert.equal(queue.drainEffects().some(effect => effect.type === 'start'), false);
  // A hidden pair does not block unrelated work.
  queue.observe(handoff('cd', 'c', 'd'));
  assert.equal(queue.getState().active?.handoff.handoffId, 'cd');
  queue.complete(queue.getState().active!.token);
  assert.equal(queue.getState().active, null);
  queue.setAgents(agents, ['a', 'b', 'c', 'd']);
  assert.equal(queue.getState().active?.handoff.handoffId, 'ab');
  assert.equal(queue.getState().hiddenSignals.length, 0);
});

test('hiding an active participant shortens the meeting without revealing or replaying it', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  const token = queue.getState().active!.token;
  queue.drainEffects();
  queue.setAgents(cohort, ['a', 'c', 'd', 'e', 'f']);
  assert.equal(queue.getState().active, null);
  const end = queue.drainEffects().find(effect => effect.type === 'end');
  assert.ok(end && end.type === 'end');
  assert.equal(end.reason, 'participant-hidden');
  assert.deepEqual(end.visibleAgentIds, ['a']);
  assert.equal(queue.complete(token), false);
  queue.setAgents(cohort, cohort.map(a => a.agentId));
  assert.equal(queue.getState().active, null);
  assert.equal(queue.getState().hiddenSignals.length, 0);
});

test('failure cancels active and queued meetings and restores latest participant truth', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.observe(handoff('ac', 'a', 'c'));
  queue.drainEffects();
  const updated = cohort.map(a => a.agentId === 'a' ? { ...a, runtimeState: 'error' as const }
    : a.agentId === 'b' ? { ...a, runtimeState: 'waiting-for-input' as const, activityKind: 'reading' as const } : a);
  queue.setAgents(updated, updated.map(a => a.agentId));
  assert.equal(queue.getState().active, null);
  assert.equal(queue.getState().queued.length, 0);
  const end = queue.drainEffects().find(effect => effect.type === 'end');
  assert.ok(end && end.type === 'end');
  assert.equal(end.reason, 'participant-unavailable');
  assert.equal(end.agents.find(a => a.agentId === 'a')?.runtimeState, 'error');
  assert.equal(end.agents.find(a => a.agentId === 'b')?.runtimeState, 'waiting-for-input');
  queue.setAgents(cohort, cohort.map(a => a.agentId));
  assert.equal(queue.observe(handoff('ac', 'a', 'c')).status, 'duplicate');
});

test('closed or missing participants cancel queued work without inventing replacement agents', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.observe(handoff('cd', 'c', 'd'));
  queue.drainEffects();
  queue.setAgents([agent('a', 'closed'), agent('c', 'closed'), agent('d')], ['a', 'c', 'd']);
  assert.equal(queue.getState().active, null);
  assert.equal(queue.getState().queued.length, 0);
  const end = queue.drainEffects().find(effect => effect.type === 'end');
  assert.ok(end && end.type === 'end');
  assert.deepEqual(end.agents.map(a => a.agentId), ['a']);
  assert.deepEqual(queue.observe(handoff('missing', 'e', 'f')),
    { status: 'dropped', reason: 'participant-unavailable' });
});

test('completion returns pets to their current work state, not the captured start state', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.drainEffects();
  queue.setAgents([agent('a', 'idle'), agent('b', 'waiting-for-approval')], ['a', 'b']);
  queue.complete(queue.getState().active!.token);
  const effect = queue.drainEffects()[0];
  assert.ok(effect.type === 'end');
  assert.deepEqual(effect.agents.map(a => a.runtimeState), ['idle', 'waiting-for-approval']);
});

test('snapshot/reconnect history never replays a meeting', () => {
  const queue = ready();
  queue.seedHistory([handoff('old')]);
  assert.equal(queue.observe(handoff('old')).status, 'duplicate');
  assert.equal(queue.getState().active, null);
  assert.equal(queue.drainEffects().length, 0);
  queue.observe(handoff('new'));
  const token = queue.getState().active!.token;
  queue.complete(token);
  queue.seedHistory([handoff('old'), handoff('new')]);
  assert.equal(queue.observe(handoff('new')).status, 'duplicate');
});

test('Reset preserves deduplication and invalidates old callbacks', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  const stale = queue.getState().active!.token;
  queue.observe(handoff('cd', 'c', 'd'));
  queue.drainEffects();
  queue.reset();
  assert.equal(queue.getState().active, null);
  assert.equal(queue.getState().queued.length, 0);
  assert.equal(queue.complete(stale), false);
  queue.setPresentation('live');
  assert.equal(queue.observe(handoff('ab')).status, 'duplicate');
  assert.equal(queue.observe(handoff('cd', 'c', 'd')).status, 'duplicate');
  queue.observe(handoff('ef', 'e', 'f'));
  assert.equal(queue.complete(stale), false);
  assert.equal(queue.getState().active?.handoff.handoffId, 'ef');
  assert.notEqual(queue.getState().active?.token.generation, stale.generation);
});

test('ready/arrivals/standup only queue; Skip to live drains without affecting agents', () => {
  const queue = createMeetingQueue();
  const before = structuredClone(cohort);
  queue.setAgents(cohort, cohort.map(a => a.agentId));
  queue.observe(handoff('ab'));
  queue.setPresentation('arrivals');
  queue.setPresentation('standup');
  assert.equal(queue.getState().active, null);
  queue.setPresentation('live');
  assert.equal(queue.getState().active?.handoff.handoffId, 'ab');
  assert.deepEqual(cohort, before);
});

test('reset removes stale starts but retains pending restore effects', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.reset();
  const effects = queue.drainEffects();
  assert.equal(effects.some(effect => effect.type === 'start'), false);
  assert.equal(effects.some(effect => effect.type === 'end' && effect.reason === 'reset'), true);
  queue.setPresentation('live');
  queue.observe(handoff('cd', 'c', 'd'));
  queue.drainEffects();
  queue.complete(queue.getState().active!.token);
  queue.reset();
  assert.equal(queue.drainEffects().some(effect => effect.type === 'end' && effect.reason === 'completed'), true);
});

test('closure before effect consumption removes the obsolete start', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.setAgents([agent('a', 'closed'), agent('b')], ['a', 'b']);
  assert.equal(queue.drainEffects().some(effect => effect.type === 'start'), false);
});

test('invalid correlation and self-meetings never animate', () => {
  const queue = ready();
  for (const bad of [
    { ...handoff('one'), sourceItemId: '' }, { ...handoff('two'), handoffId: ' ' },
    handoff('self', 'a', 'a'), { ...handoff('three'), toAgentId: '' },
  ]) assert.deepEqual(queue.observe(bad), { status: 'dropped', reason: 'invalid-handoff' });
  assert.equal(queue.getState().active, null);
  assert.equal(queue.getState().queued.length, 0);
});

test('input and exposed state mutations cannot retarget queued/active pairs', () => {
  const queue = ready();
  const input = handoff('ab');
  queue.observe(input);
  input.toAgentId = 'c';
  const state = queue.getState();
  state.active!.handoff.toAgentId = 'd';
  assert.equal(queue.getState().active?.handoff.toAgentId, 'b');
});

test('pending restore effects use state and visibility at delivery time', () => {
  const queue = ready();
  queue.observe(handoff('ab'));
  queue.drainEffects();
  queue.complete(queue.getState().active!.token);
  queue.setAgents([agent('a', 'waiting-for-input'), agent('b', 'closed')], ['a']);
  const end = queue.drainEffects().find(effect => effect.type === 'end');
  assert.ok(end && end.type === 'end');
  assert.deepEqual(end.visibleAgentIds, ['a']);
  assert.deepEqual(end.agents.map(a => a.runtimeState), ['waiting-for-input', 'closed']);
});
