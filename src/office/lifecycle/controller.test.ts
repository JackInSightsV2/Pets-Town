import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent } from '../../shared/contract.js';
import { normalizeTurnLifecycle } from '../../codex/lifecycle/normalizer.js';
import type { TurnLifecycleObservation, TurnLifecycleStatus } from '../../shared/turn-lifecycle.js';
import { createTurnLifecycleController } from './controller.js';

const agent = (agentId = 'agent-a', overrides: Partial<OfficeAgent> = {}): OfficeAgent => ({ agentId, parentAgentId: null, projectId: 'project-a',
  displayName: 'Synthetic agent', role: null, task: null, runtimeState: 'unknown', activityKind: 'unknown', lastObservedAt: null,
  pendingRequestIds: [], petAssetId: null, recentActivity: [], ...overrides });
const observation = (status: TurnLifecycleStatus, turnId = 'turn-a', extra: Partial<TurnLifecycleObservation> = {}): TurnLifecycleObservation => {
  const result = normalizeTurnLifecycle({ source: 'fixture', sourceNamespace: 'synthetic-source', threadId: extra.agentId ?? 'agent-a', agentId: extra.agentId ?? 'agent-a',
    observedAt: '2026-01-01T00:00:00Z', delivery: 'live', format: 'notification', value: {
      method: status === 'started' ? 'turn/started' : 'turn/completed', params: { threadId: extra.agentId ?? 'agent-a', turn: {
        id: turnId, status: { started: 'inProgress', succeeded: 'completed', failed: 'failed', interrupted: 'interrupted' }[status], startedAt: turnId === 'turn-b' ? 200 : turnId === 'turn-c' ? 300 : 100,
      } },
    } });
  if (result.kind !== 'observed') throw new Error('Invalid synthetic observation.');
  return { ...result.observation, ...extra };
};
function setup(latestTurns: TurnLifecycleObservation[] = [observation('started')], agents = [agent()]) {
  const controller = createTurnLifecycleController();
  const generation = controller.baseline({ agents, latestTurns, connected: true, presentation: 'live' });
  return { controller, generation, state: () => controller.getState()[0] };
}

test('successful current turn exits, hides only the sprite, and new work returns', () => {
  const sourceAgent = agent('agent-a', { runtimeState: 'working' });
  const original = structuredClone(sourceAgent);
  const { controller, generation, state } = setup([observation('started')], [sourceAgent]);
  assert.equal(controller.observe(observation('succeeded'), generation), 'applied');
  const [exit] = controller.drainEffects(); assert.equal(exit.type, 'exit');
  assert.equal(state().visible, true); assert.equal(state().phase, 'leaving');
  assert.equal(controller.complete(exit.token), true); assert.equal(state().visible, false);
  controller.observe(observation('started', 'turn-b', { startedAt: 200 }), generation);
  const [enter] = controller.drainEffects(); assert.equal(enter.type, 'enter');
  controller.complete(enter.token); assert.equal(state().phase, 'present');
  assert.deepEqual(sourceAgent, original);
});

test('failure dies then disappears; interruption sleeps and a new turn wakes', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('failed'), generation);
  const [death] = controller.drainEffects(); assert.equal(death.type, 'die');
  assert.equal(state().pose, 'dying'); assert.equal(state().visible, true);
  controller.complete(death.token); assert.equal(state().pose, 'dead'); assert.equal(state().visible, false);
  controller.observe(observation('started', 'turn-b'), generation);
  controller.complete(controller.drainEffects()[0].token);
  controller.observe(observation('interrupted', 'turn-b'), generation);
  assert.equal(controller.drainEffects()[0].type, 'sleep'); assert.equal(state().pose, 'sleeping'); assert.equal(state().visible, true);
  controller.observe(observation('started', 'turn-c'), generation);
  assert.equal(controller.drainEffects()[0].type, 'wake'); assert.equal(state().pose, 'awake');
});

test('start during exit/death invalidates callbacks; stale completion cannot hide the next turn', () => {
  for (const terminal of ['succeeded', 'failed'] as const) {
    const { controller, generation, state } = setup();
    controller.observe(observation(terminal), generation);
    const old = controller.drainEffects()[0].token;
    controller.observe(observation('started', 'turn-b', { startedAt: 200 }), generation);
    assert.equal(controller.complete(old), false); assert.equal(state().visible, true); assert.equal(state().status, 'started');
    controller.observe(observation('interrupted'), generation);
    assert.equal(state().status, 'started');
  }
});

test('duplicate turns and contradictory terminal outcomes never replay movement', () => {
  const { controller, generation, state } = setup();
  assert.equal(controller.observe(observation('started'), generation), 'duplicate');
  controller.observe(observation('succeeded'), generation);
  const exit = controller.drainEffects()[0]; controller.complete(exit.token);
  assert.equal(controller.observe(observation('succeeded', 'turn-a', { occurredAt: '2026-01-02T00:00:00Z' }), generation), 'duplicate');
  assert.equal(controller.observe(observation('failed'), generation), 'ignored');
  assert.deepEqual(controller.drainEffects(), []); assert.equal(state().status, 'succeeded');
});

test('bootstrap uses latest verified status silently; unknown initial presence is explicit', () => {
  for (const [status, visible, phase] of [['succeeded', false, 'absent'], ['failed', false, 'absent'], ['interrupted', true, 'sleeping'], ['started', true, 'present']] as const) {
    const { controller, state } = setup([observation(status, 'turn-a', { delivery: 'history' })]);
    assert.equal(state().visible, visible); assert.equal(state().phase, phase); assert.deepEqual(controller.drainEffects(), []);
  }
  const { state } = setup([]);
  assert.equal(state().visible, null); assert.equal(state().status, null); assert.equal(state().phase, 'unknown');
});

test('reconnect cancels motion, ignores the old delivery generation, and never replays historical effects', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('failed'), generation);
  const death = controller.drainEffects()[0]; controller.suspend();
  assert.equal(controller.complete(death.token), false);
  assert.equal(controller.observe(observation('started', 'turn-b'), generation), 'ignored');
  const next = controller.baseline({ agents: [agent()], latestTurns: [observation('started', 'turn-b', { delivery: 'history' })], connected: true, presentation: 'live' });
  assert.equal(state().phase, 'present'); assert.deepEqual(controller.drainEffects(), []);
  assert.equal(controller.observe(observation('failed', 'turn-b'), generation), 'ignored');
  assert.equal(controller.observe(observation('succeeded', 'turn-b'), next), 'applied');
});

test('unknown/disconnected metadata does not manufacture an outcome', () => {
  const { controller, state } = setup();
  controller.setAgents([agent('agent-a', { runtimeState: 'idle' })]);
  assert.equal(state().status, 'started');
  controller.setAgents([agent('agent-a', { runtimeState: 'error' })]);
  controller.suspend(); assert.equal(state().status, 'started'); assert.equal(state().visible, true);
  assert.deepEqual(controller.drainEffects(), []);
});

test('waiting flags and pending requests remain visible after an offstage outcome', () => {
  for (const patch of [{ pendingRequestIds: ['synthetic-request'] }, { runtimeState: 'waiting-for-input' as const }, { runtimeState: 'waiting-for-approval' as const }]) {
    const waitingAgent = agent('agent-a', patch);
    const { controller, state } = setup([observation('succeeded')], [waitingAgent]);
    assert.equal(state().visible, true); assert.equal(state().attention, true); assert.equal(state().meetingEligible, false);
    controller.setAgents([agent()]); assert.equal(state().visible, false); assert.deepEqual(controller.drainEffects(), []);
    assert.deepEqual(waitingAgent, agent('agent-a', patch));
  }
});

test('attention arriving during exit cancels its callback and pins the indicator without replay', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('succeeded'), generation); const token = controller.drainEffects()[0].token;
  controller.setAgents([agent('agent-a', { pendingRequestIds: ['synthetic-request'] })]);
  assert.equal(controller.complete(token), false); assert.equal(state().visible, true);
  controller.setAgents([agent()]); assert.equal(state().visible, false); assert.deepEqual(controller.drainEffects(), []);
});

test('parent completion leaves child lifecycle independent', () => {
  const { controller, generation } = setup([observation('started'), observation('started', 'child-turn', { agentId: 'child-a' })],
    [agent(), agent('child-a', { parentAgentId: 'agent-a' })]);
  controller.observe(observation('succeeded'), generation); controller.complete(controller.drainEffects()[0].token);
  const child = controller.getState().find(row => row.agentId === 'child-a')!;
  assert.equal(child.status, 'started'); assert.equal(child.visible, true); assert.equal(child.meetingEligible, true);
});

test('missing start, unknown agent, old start and unsupported observation cannot hide current work', () => {
  const { controller, generation, state } = setup([observation('started', 'turn-b', { startedAt: 200 })]);
  assert.equal(controller.observe(observation('succeeded'), generation), 'ignored');
  assert.equal(controller.observe(observation('started', 'turn-old', { startedAt: 100 }), generation), 'ignored');
  assert.equal(controller.observe(observation('failed', 'turn-c', { agentId: 'other-agent' }), generation), 'unavailable');
  assert.equal(controller.observe({} as TurnLifecycleObservation, generation), 'unavailable');
  assert.equal(state().status, 'started'); assert.deepEqual(controller.drainEffects(), []);
});

test('presentation changes settle motion and consume events without queuing stale arrivals', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('succeeded'), generation); const token = controller.drainEffects()[0].token;
  controller.setPresentation('ready'); assert.equal(controller.complete(token), false);
  controller.observe(observation('started', 'turn-b'), generation);
  assert.equal(state().phase, 'present'); assert.deepEqual(controller.drainEffects(), []);
  controller.setPresentation('live'); assert.deepEqual(controller.drainEffects(), []);
  controller.observe(observation('interrupted', 'turn-b'), generation); assert.equal(state().phase, 'sleeping');
});

test('history catch-up settles silently and capacity fails closed instead of evicting dedup', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('succeeded', 'turn-a', { delivery: 'history' }), generation);
  assert.equal(state().visible, false); assert.deepEqual(controller.drainEffects(), []);
  const bounded = createTurnLifecycleController({ maxObservations: 1 });
  const boundedGeneration = bounded.baseline({ agents: [agent()], latestTurns: [observation('started')], connected: true, presentation: 'live' });
  assert.equal(bounded.observe(observation('succeeded'), boundedGeneration), 'unavailable');
  assert.equal(bounded.getState()[0].phase, 'present');
});

test('reconnect baseline cannot regress terminal or retired turns', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('succeeded'), generation);
  controller.complete(controller.drainEffects()[0].token);
  controller.baseline({ agents: [agent()], latestTurns: [observation('started')], connected: true, presentation: 'live' });
  assert.equal(state().status, 'succeeded'); assert.equal(state().visible, false);
  controller.observe(observation('started', 'turn-b', { startedAt: 200 }), controller.getGeneration());
  controller.baseline({ agents: [agent()], latestTurns: [observation('succeeded')], connected: true, presentation: 'live' });
  assert.equal(state().status, 'started'); assert.equal(state().phase, 'present');
  controller.baseline({ agents: [agent()], latestTurns: [observation('started', 'unseen-old-turn', { startedAt: 150 })], connected: true, presentation: 'live' });
  assert.equal(state().turnId, observation('started', 'turn-b').turnId);
  assert.deepEqual(controller.drainEffects(), []);
});

test('removed agents cannot receive queued effects and offline or ceremony sprites cannot meet', () => {
  const { controller, generation, state } = setup([]);
  controller.observe(observation('started'), generation);
  controller.setAgents([]); assert.deepEqual(controller.drainEffects(), []); assert.deepEqual(controller.getState(), []);
  controller.baseline({ agents: [agent()], latestTurns: [observation('started')], connected: true, presentation: 'live' });
  assert.equal(state().meetingEligible, true);
  controller.setPresentation('standup'); assert.equal(state().meetingEligible, false);
  controller.setPresentation('live'); controller.suspend(); assert.equal(state().meetingEligible, false);
});

test('animation tokens compare values independent of property insertion order', () => {
  const { controller, generation, state } = setup();
  controller.observe(observation('succeeded'), generation);
  const token = controller.drainEffects()[0].token;
  assert.equal(controller.complete({ turnId: token.turnId, agentId: token.agentId, serial: token.serial, generation: token.generation }), true);
  assert.equal(state().visible, false);
});

test('invalid baseline rows fail closed without throwing or changing initial presence', () => {
  const { controller, state } = setup([null as unknown as TurnLifecycleObservation]);
  assert.equal(state().visible, null); assert.deepEqual(controller.drainEffects(), []);
});

test('late history terminal establishes presence without a missed start or animation', () => {
  const {controller,generation,state}=setup([]);
  assert.equal(controller.observe(observation('interrupted','late-turn',{delivery:'history'}),generation),'applied');
  assert.equal(state().phase,'sleeping');assert.deepEqual(controller.drainEffects(),[]);
});

test('replayed source baseline settles an in-flight terminal despite semantic dedup', () => {
  const {controller,generation,state}=setup();
  controller.observe(observation('failed'),generation);const token=controller.drainEffects()[0].token;
  controller.observe(observation('failed','turn-a',{delivery:'history'}),generation);
  assert.equal(state().visible,false);assert.equal(controller.complete(token),false);assert.deepEqual(controller.drainEffects(),[]);
});

test('different-turn null and equal source starts cannot replace current presentation or bootstrap', () => {
  for(const startedAt of [null,200]) {
    const {controller,generation,state}=setup([observation('started','turn-b',{startedAt:200})]);
    assert.equal(controller.observe(observation('started','ambiguous',{startedAt}),generation),'ignored');
    controller.baseline({agents:[agent()],latestTurns:[observation('succeeded','old',{startedAt,delivery:'history'})],connected:true,presentation:'live'});
    assert.equal(state().turnId,observation('started','turn-b').turnId);
    assert.equal(state().status,'started');assert.deepEqual(controller.drainEffects(),[]);
  }
});
