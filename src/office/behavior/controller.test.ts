import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot, type OfficeAgent, type OfficeRequest, type PetAsset } from '../../shared/contract';
import type { TurnLifecycleObservation, TurnLifecycleStatus } from '../../shared/turn-lifecycle';
import { normalizeTurnLifecycle } from '../../codex/lifecycle/normalizer';
import { createOfficeLayout, DEFAULT_OFFICE_GEOMETRY } from '../layout';
import type { Meeting } from '../handoffs/meeting-queue';
import { createTurnLifecycleController, type SpriteLifecycle } from '../lifecycle/controller';
import { createOfficeBehaviorController, OFFICE_EXCHANGE_MS, OFFICE_WALK_MS, type OfficeBehaviorInput } from './controller';

const agent = (agentId: string, parentAgentId: string | null = null): OfficeAgent => ({
  agentId, parentAgentId, projectId: 'synthetic-project', displayName: `Synthetic ${agentId}`,
  role: null, task: null, runtimeState: 'working', activityKind: 'editing', lastObservedAt: null,
  pendingRequestIds: [], petAssetId: 'synthetic-pet', recentActivity: [],
});
const asset: PetAsset = {
  assetId: 'synthetic-pet', name: 'Synthetic atlas', imageUrl: '/synthetic-atlas.png', origin: 'codex',
  width: 320, height: 480, columns: 4, rows: 6,
  animations: {
    idle: { row: 0, frames: 4, fps: 4 }, waving: { row: 1, frames: 4, fps: 4 },
    failed: { row: 2, frames: 4, fps: 8 }, waiting: { row: 3, frames: 4, fps: 4 },
    'running-left': { row: 4, frames: 4, fps: 8 }, 'running-right': { row: 5, frames: 4, fps: 8 },
  },
};
const life = (agentId: string, changes: Partial<SpriteLifecycle> = {}): SpriteLifecycle => ({
  agentId, turnId: 'synthetic-turn', status: 'started', phase: 'present', pose: 'awake',
  visible: true, attention: false, meetingEligible: true, token: null, ...changes,
});
const meeting = (serial = 1): Meeting => ({
  token: { generation: 1, serial, handoffId: `synthetic-handoff-${serial}` },
  handoff: { handoffId: `synthetic-handoff-${serial}`, fromAgentId: 'parent', toAgentId: 'child',
    summary: 'Synthetic observed handoff', occurredAt: '2026-11-01T12:00:00Z', sourceItemId: `synthetic-item-${serial}` },
});
const request = (agentId: string): OfficeRequest => ({
  requestId: 'synthetic-request', agentId, kind: 'user-input', prompt: null, options: [],
  createdAt: '2026-11-01T12:00:00Z', responseCapability: { supported: false, reason: 'Observation only' }, revision: null,
});
function input(): OfficeBehaviorInput {
  const snapshot = emptySnapshot('synthetic-epoch');
  snapshot.officeSessionId = 'synthetic-office';
  snapshot.source = 'fixture';
  snapshot.presentation = { state: 'live', canSkip: false };
  snapshot.connection = { status: 'connected', lastObservedAt: null, message: null };
  snapshot.agents = [agent('parent'), agent('child', 'parent')];
  snapshot.petAssets = [structuredClone(asset)];
  const geometry = { ...structuredClone(DEFAULT_OFFICE_GEOMETRY), canvas: { width: 1200, height: 800 },
    spacing: { x: 100, y: 100 }, waterCooler: [{ x: 500, y: 500 }, { x: 700, y: 500 }] as const };
  return {
    snapshot, visibleAgents: snapshot.agents, geometry,
    layout: { width: 1200, height: 800, areas: [], homes: new Map([
      ['parent', { x: 100, y: 100 }], ['child', { x: 900, y: 100 }],
    ]), entrance: { x: 500, y: 700 }, standup: { x: 500, y: 350 }, rest: { x: 500, y: 600 },
    waterCooler: geometry.waterCooler },
    entrances: new Map([['parent', { x: 500, y: 700 }], ['child', { x: 600, y: 700 }]]),
    standups: new Map([['parent', { x: 500, y: 350 }], ['child', { x: 600, y: 350 }]]),
    rests: new Map([['parent', { x: 500, y: 600 }], ['child', { x: 600, y: 600 }]]),
    lifecycles: [life('parent'), life('child')], snapshotRevision: 1, transportConnected: true,
    meeting: null, realHandoffPending: false, reducedMotion: false,
  };
}
function observation(status: TurnLifecycleStatus, turnId = 'synthetic-turn-a', startedAt = 100): TurnLifecycleObservation {
  const result = normalizeTurnLifecycle({ source: 'fixture', sourceNamespace: 'synthetic-behavior-tests',
    threadId: 'parent', agentId: 'parent', observedAt: '2026-11-01T12:00:00Z', delivery: 'live', format: 'notification',
    value: { method: status === 'started' ? 'turn/started' : 'turn/completed', params: { threadId: 'parent',
      turn: { id: turnId, status: { started: 'inProgress', succeeded: 'completed', failed: 'failed', interrupted: 'interrupted' }[status], startedAt } } },
  });
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') throw new Error('Invalid synthetic lifecycle observation');
  return result.observation;
}
function lifecycleInput(latestTurns = [observation('started')]) {
  const current = input();
  const lifecycle = createTurnLifecycleController();
  const generation = lifecycle.baseline({ agents: current.snapshot!.agents, latestTurns, connected: true, presentation: 'live' });
  const refresh = () => { current.lifecycles = lifecycle.getState(); };
  refresh();
  return { current, lifecycle, generation, refresh };
}

test('real handoffs capture the prior proximity plan and retain it throughout return', () => {
  const controller = createOfficeBehaviorController();
  const current = input();
  const settled = controller.update(current, 0);
  const returns = new Map(settled.placed.map(pet => [pet.agent.agentId, pet.point]));
  assert.notDeepEqual(returns.get('child'), current.layout.homes.get('child'));
  current.meeting = meeting();
  const approach = controller.update(current, 1);
  assert.equal(approach.meetingPhase, 'approaching');
  for (const pet of approach.placed) {
    assert.deepEqual(pet.home, returns.get(pet.agent.agentId));
    assert.deepEqual(pet.point, current.layout.waterCooler[pet.participantIndex]);
  }
  current.layout = { ...current.layout, homes: new Map([['parent', { x: 300, y: 200 }], ['child', { x: 1000, y: 200 }]]) };
  const returning = controller.update(current, 1 + OFFICE_WALK_MS + OFFICE_EXCHANGE_MS);
  assert.equal(returning.meetingPhase, 'returning');
  for (const pet of returning.placed) assert.deepEqual(pet.point, returns.get(pet.agent.agentId));
  const completed = controller.update(current, 1 + OFFICE_WALK_MS * 2 + OFFICE_EXCHANGE_MS);
  assert.equal(completed.meeting, null);
  assert.deepEqual(completed.completedMeetings, [current.meeting.token]);
  controller.acknowledge(completed);
  assert.deepEqual(controller.update(current, 10_000).completedMeetings, []);
});

test('lifecycle and request attention cancel real meetings once without stale return placement', () => {
  const changes: Array<[string, (current: OfficeBehaviorInput) => void]> = [
    ['exit', current => { current.lifecycles = [life('parent', { phase: 'leaving', status: 'succeeded', meetingEligible: false }), life('child')]; }],
    ['death', current => { current.lifecycles = [life('parent', { phase: 'dying', pose: 'dying', status: 'failed', meetingEligible: false }), life('child')]; }],
    ['sleep', current => { current.lifecycles = [life('parent', { phase: 'sleeping', pose: 'sleeping', status: 'interrupted', meetingEligible: false }), life('child')]; }],
    ['request record', current => { current.snapshot!.pendingRequests = [request('parent')]; }],
    ['request id', current => { current.snapshot!.agents[0].pendingRequestIds = ['synthetic-request']; }],
    ['waiting state', current => { current.snapshot!.agents[0].runtimeState = 'waiting-for-input'; }],
    ['hidden pet', current => { current.visibleAgents = [current.snapshot!.agents[1]]; }],
    ['missing artwork', current => { current.snapshot!.agents[0].petAssetId = null; }],
  ];
  for (const [label, change] of changes) {
    const current = input();
    current.meeting = meeting();
    const controller = createOfficeBehaviorController();
    assert.equal(controller.update(current, 0).meetingPhase, 'approaching', label);
    change(current);
    const cancelled = controller.update(current, 10);
    assert.equal(cancelled.meeting, null, label);
    assert.equal(cancelled.meetingPhase, 'none', label);
    assert.deepEqual(cancelled.completedMeetings, [current.meeting.token], label);
    assert.ok(cancelled.placed.every(pet => pet.participantIndex === -1 && pet.location !== 'water-cooler'), label);
    controller.acknowledge(cancelled);
    assert.deepEqual(controller.update(current, 10_000).completedMeetings, [], label);
  }
});

test('attention pins a terminal sprite without changing the source runtime or lifecycle outcome', () => {
  const current = input();
  current.lifecycles = [life('parent', { status: 'failed', phase: 'absent', pose: 'dead', visible: false, meetingEligible: false }), life('child')];
  current.snapshot!.pendingRequests = [request('parent')];
  const before = structuredClone(current.snapshot);
  const frame = createOfficeBehaviorController().update(current, 0);
  const parent = frame.placed.find(pet => pet.agent.agentId === 'parent');
  assert.ok(parent);
  assert.equal(parent.animationName, undefined);
  assert.equal(parent.lifecyclePhase, 'absent');
  assert.deepEqual(current.snapshot, before);
});

test('active and queued real handoffs suppress decorative check-ins and cancellation starts a fresh cooldown', () => {
  for (const queued of [true, false]) {
    const current = input();
    const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
    assert.equal(controller.update(current, 0).checkIn, null);
    assert.ok(controller.update(current, 100).checkIn);
    if (queued) current.realHandoffPending = true;
    else current.meeting = meeting();
    assert.equal(controller.update(current, 101).checkIn, null);
    assert.equal(controller.update(current, 500).checkIn, null);
    current.realHandoffPending = false;
    current.meeting = null;
    assert.equal(controller.update(current, 599).checkIn, null);
    assert.ok(controller.update(current, 600).checkIn);
  }
});

test('proven terminal baselines stay absent or asleep while unknown presence remains explicit and static', () => {
  for (const status of ['succeeded', 'failed', 'interrupted'] as const) {
    const { current } = lifecycleInput([observation(status)]);
    const controller = createOfficeBehaviorController();
    const frame = controller.update(current, 0);
    const parent = frame.placed.find(pet => pet.agent.agentId === 'parent');
    if (status === 'interrupted') {
      assert.ok(parent);
      assert.equal(parent.lifecyclePhase, 'sleeping');
      assert.equal(parent.animationName, 'waiting');
    } else assert.equal(parent, undefined);
    assert.deepEqual(frame.completedLifecycles, []);
    const child = frame.placed.find(pet => pet.agent.agentId === 'child');
    assert.ok(child);
    assert.equal(child.lifecyclePhase, 'unknown');
    assert.equal(child.motion, 'settled');
    assert.equal(current.snapshot!.agents[0].runtimeState, 'working');
  }
});

test('a live terminal completes once, and a newer turn invalidates the old movement callback', () => {
  for (const status of ['succeeded', 'failed'] as const) {
    const { current, lifecycle, generation, refresh } = lifecycleInput();
    const controller = createOfficeBehaviorController();
    controller.update(current, 0);
    assert.equal(lifecycle.observe(observation(status), generation), 'applied');
    refresh();
    const oldToken = current.lifecycles.find(item => item.agentId === 'parent')!.token!;
    const terminal = controller.update(current, 1);
    assert.deepEqual(terminal.completedLifecycles, []);
    assert.equal(terminal.placed.find(pet => pet.agent.agentId === 'parent')!.lifecyclePhase, status === 'failed' ? 'dying' : 'leaving');
    assert.equal(lifecycle.observe(observation('started', 'synthetic-turn-b', 200), generation), 'applied');
    refresh();
    assert.equal(lifecycle.complete(oldToken), false);
    const newer = controller.update(current, OFFICE_WALK_MS * 2);
    assert.ok(newer.placed.some(pet => pet.agent.agentId === 'parent'));
    assert.ok(newer.completedLifecycles.every(token => token.turnId !== oldToken.turnId));
    assert.equal(lifecycle.getState().find(item => item.agentId === 'parent')!.status, 'started');
  }
});

test('native failed frames bound death then disappear after lifecycle completion', () => {
  const { current, lifecycle, generation, refresh } = lifecycleInput();
  const controller = createOfficeBehaviorController();
  lifecycle.observe(observation('failed'), generation);
  refresh();
  const first = controller.update(current, 0);
  assert.equal(first.placed.find(pet => pet.agent.agentId === 'parent')!.animationName, 'failed');
  const duration = asset.animations.failed.frames / asset.animations.failed.fps * 1000;
  assert.deepEqual(controller.update(current, duration - 1).completedLifecycles, []);
  const completed = controller.update(current, duration);
  assert.equal(completed.completedLifecycles.length, 1);
  assert.equal(lifecycle.complete(completed.completedLifecycles[0]), true);
  controller.acknowledge(completed);
  refresh();
  assert.ok(controller.update(current, duration + 1).placed.every(pet => pet.agent.agentId !== 'parent'));
  assert.deepEqual(controller.update(current, duration + 2).completedLifecycles, []);
});

test('reduced motion and unavailable native artwork still settle exit and death tokens exactly once', () => {
  for (const status of ['succeeded', 'failed'] as const) {
    for (const missingArtwork of [false, true]) {
      const { current, lifecycle, generation, refresh } = lifecycleInput();
      current.reducedMotion = !missingArtwork;
      if (missingArtwork) current.snapshot!.petAssets = [];
      lifecycle.observe(observation(status), generation);
      refresh();
      const controller = createOfficeBehaviorController();
      const completed = controller.update(current, 0);
      assert.equal(completed.completedLifecycles.length, 1);
      controller.acknowledge(completed);
      assert.deepEqual(controller.update(current, 1).completedLifecycles, []);
      assert.equal(lifecycle.complete(completed.completedLifecycles[0]), true);
      refresh();
      assert.ok(controller.update(current, 2).placed.every(pet => pet.agent.agentId !== 'parent'));
    }
  }
});

test('authoritative replacement and reconnect cancel choreography without replaying a stale meeting token', () => {
  const changes: Array<(current: OfficeBehaviorInput) => void> = [
    current => { current.snapshotRevision++; },
    current => { current.snapshot!.bridgeEpoch = 'synthetic-next-epoch'; },
    current => { current.snapshot!.officeSessionId = 'synthetic-next-session'; },
    current => { current.transportConnected = false; },
    current => { current.snapshot!.connection.status = 'reconnecting'; },
    current => { current.snapshot!.presentation.state = 'ready'; },
  ];
  for (const change of changes) {
    const current = input();
    current.meeting = meeting();
    const controller = createOfficeBehaviorController();
    assert.equal(controller.update(current, 0).meetingPhase, 'approaching');
    change(current);
    assert.equal(controller.update(current, 10).meeting, null);
    current.transportConnected = true;
    current.snapshot!.connection.status = 'connected';
    current.snapshot!.presentation.state = 'live';
    assert.equal(controller.update(current, 20).meeting, null);
    assert.deepEqual(controller.update(current, 10_000).completedMeetings, []);
    current.meeting = meeting(2);
    assert.equal(controller.update(current, 10_001).meetingPhase, 'approaching');
  }
});

test('same-session authoritative snapshot replacement cancels decorative state and restarts its cadence', () => {
  const current = input();
  const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
  controller.update(current, 0);
  const first = controller.update(current, 100).checkIn;
  assert.ok(first);
  current.snapshotRevision++;
  assert.equal(controller.update(current, 101).checkIn, null);
  assert.equal(controller.update(current, 200).checkIn, null);
  const next = controller.update(current, 201).checkIn;
  assert.ok(next);
  assert.notDeepEqual(next.token, first.token);
});

test('reduced-motion meeting exchanges without approach and releases its exact token once', () => {
  const current = input();
  current.reducedMotion = true;
  current.meeting = meeting();
  const controller = createOfficeBehaviorController();
  assert.equal(controller.update(current, 0).meetingPhase, 'exchanging');
  assert.deepEqual(controller.update(current, OFFICE_EXCHANGE_MS - 1).completedMeetings, []);
  const completed = controller.update(current, OFFICE_EXCHANGE_MS);
  assert.deepEqual(completed.completedMeetings, [current.meeting.token]);
  controller.acknowledge(completed);
  assert.deepEqual(controller.update(current, OFFICE_EXCHANGE_MS + 1).completedMeetings, []);
});

test('discarded render retries retain meeting and lifecycle completions until the committed frame acknowledges them', () => {
  const { current, lifecycle, generation, refresh } = lifecycleInput();
  current.reducedMotion = true;
  current.meeting = meeting();
  lifecycle.observe(observation('failed'), generation);
  refresh();
  const controller = createOfficeBehaviorController();
  const discarded = controller.update(current, 0);
  assert.deepEqual(discarded.completedMeetings, [current.meeting.token]);
  assert.equal(discarded.completedLifecycles.length, 1);
  const retried = controller.update(current, 1);
  assert.deepEqual(retried.completedMeetings, discarded.completedMeetings);
  assert.deepEqual(retried.completedLifecycles, discarded.completedLifecycles);
  controller.acknowledge(retried);
  const acknowledged = controller.update(current, 2);
  assert.deepEqual(acknowledged.completedMeetings, []);
  assert.deepEqual(acknowledged.completedLifecycles, []);
  // A duplicate acknowledgement of the discarded frame stays harmless.
  controller.acknowledge(discarded);
  assert.deepEqual(controller.update(current, 3).completedMeetings, []);
  assert.deepEqual(controller.update(current, 3).completedLifecycles, []);
});

test('a sibling becoming idle cannot occupy a captured meeting return destination', () => {
  const current = input();
  const agents = [agent('a-parent'), agent('b-other'), agent('c-child', 'a-parent'), agent('d-child', 'a-parent')];
  agents[0].runtimeState = 'idle';
  current.snapshot!.agents = agents;
  current.visibleAgents = agents;
  current.lifecycles = [];
  current.geometry = structuredClone(DEFAULT_OFFICE_GEOMETRY);
  current.layout = createOfficeLayout().map(current.snapshot!);
  // These are the scene's default first-row rest destinations for sorted IDs.
  // The unrelated root shifts the first child's allocated rest to the right.
  current.rests = new Map([
    ['a-parent', { x: 500, y: 560 }], ['b-other', { x: 388, y: 560 }],
    ['c-child', { x: 612, y: 560 }], ['d-child', { x: 276, y: 560 }],
  ]);
  current.entrances = new Map(agents.map(value => [value.agentId, current.layout.entrance]));
  current.standups = new Map(agents.map(value => [value.agentId, current.layout.standup]));
  const controller = createOfficeBehaviorController();
  const initial = controller.update(current, 0);
  const captured = initial.placed.find(pet => pet.agent.agentId === 'd-child')!.point;
  current.meeting = meeting();
  current.meeting.handoff.fromAgentId = 'a-parent';
  current.meeting.handoff.toAgentId = 'd-child';
  assert.equal(controller.update(current, 1).meetingPhase, 'approaching');
  agents[2].runtimeState = 'idle';
  const returning = controller.update(current, 1 + OFFICE_WALK_MS + OFFICE_EXCHANGE_MS);
  assert.equal(returning.meetingPhase, 'returning');
  const sibling = returning.placed.find(pet => pet.agent.agentId === 'c-child')!;
  const participant = returning.placed.find(pet => pet.agent.agentId === 'd-child')!;
  assert.deepEqual(sibling.point, current.rests.get('c-child'));
  assert.deepEqual(participant.point, captured, 'the meeting keeps its captured return');
  assert.ok(Math.abs(sibling.point.x - participant.point.x) >= current.geometry.spacing.x
    || Math.abs(sibling.point.y - participant.point.y) >= current.geometry.spacing.y,
  'the returning participant and newly idle sibling must not overlap');
});

for (const status of ['interrupted', 'failed'] as const) {
  test(`a nearby child keeps its settled point while ${status === 'failed' ? 'dying' : 'sleeping'}`, () => {
    const current = input();
    const controller = createOfficeBehaviorController();
    const before = controller.update(current, 0).placed.find(pet => pet.agent.agentId === 'child')!;
    assert.notDeepEqual(before.point, current.layout.homes.get('child'), 'the child has moved near its parent');
    const dying = status === 'failed';
    current.lifecycles = [life('parent'), life('child', {
      status, phase: dying ? 'dying' : 'sleeping', pose: dying ? 'dying' : 'sleeping', meetingEligible: false,
      token: dying ? { generation: 1, serial: 1, agentId: 'child', turnId: 'synthetic-turn' } : null,
    })];
    const terminal = controller.update(current, 1).placed.find(pet => pet.agent.agentId === 'child')!;
    assert.deepEqual(terminal.point, before.point, 'the terminal pose begins at the settled family position');
    assert.equal(terminal.animationName, dying ? 'failed' : 'waiting');
    assert.equal(terminal.motion, 'settled');
    current.layout = { ...current.layout, homes: new Map([['parent', { x: 500, y: 200 }], ['child', { x: 900, y: 100 }]]) };
    const later = controller.update(current, 10).placed.find(pet => pet.agent.agentId === 'child')!;
    assert.deepEqual(later.point, before.point, 'parent movement does not drag a terminal pose');
    assert.equal(later.animationName, dying ? 'failed' : 'waiting');
  });
}

test('disconnect preserves settled family positions until connected truth can replan them', () => {
  const current = input();
  const controller = createOfficeBehaviorController();
  const before = controller.update(current, 0);
  const settled = new Map(before.placed.map(pet => [pet.agent.agentId, pet.point]));
  assert.notDeepEqual(settled.get('child'), current.layout.homes.get('child'));
  current.transportConnected = false;
  current.snapshot!.connection.status = 'disconnected';
  const disconnected = controller.update(current, 1);
  assert.deepEqual(new Map(disconnected.placed.map(pet => [pet.agent.agentId, pet.point])), settled);
  assert.equal(disconnected.checkIn, null);
  assert.equal(disconnected.meeting, null);
  assert.deepEqual(disconnected.completedLifecycles, []);
  current.layout = { ...current.layout, homes: new Map([['parent', { x: 500, y: 200 }], ['child', { x: 900, y: 100 }]]) };
  assert.deepEqual(new Map(controller.update(current, 2).placed.map(pet => [pet.agent.agentId, pet.point])), settled);
  current.transportConnected = true;
  current.snapshot!.connection.status = 'connected';
  const recovered = controller.update(current, 3);
  assert.notDeepEqual(recovered.placed.find(pet => pet.agent.agentId === 'parent')!.point, settled.get('parent'));
  assert.equal(recovered.placed.find(pet => pet.agent.agentId === 'child')!.lifecyclePhase, 'present');
});

test('verified current turns give unknown metadata pets family placement and waves without changing observed agents', () => {
  const current = input();
  for (const sourceAgent of current.snapshot!.agents) sourceAgent.runtimeState = 'unknown';
  const before = structuredClone(current.snapshot);
  const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
  const settled = controller.update(current, 0);
  assert.equal(settled.checkIn, null);
  const child = settled.placed.find(pet => pet.agent.agentId === 'child')!;
  assert.notDeepEqual(child.point, current.layout.homes.get('child'));
  assert.equal(child.location, 'family');
  const waving = controller.update(current, 100);
  assert.ok(waving.checkIn);
  assert.equal(waving.checkIn.parentAgentId, 'parent');
  assert.equal(waving.checkIn.childAgentId, 'child');
  for (const pet of waving.placed) {
    assert.equal(pet.visualState, 'working');
    assert.equal(pet.animationName, 'waving');
    assert.equal(pet.agent.runtimeState, 'unknown');
    assert.strictEqual(pet.agent, current.snapshot!.agents.find(sourceAgent => sourceAgent.agentId === pet.agent.agentId));
  }
  assert.deepEqual(current.snapshot, before);
});

test('unknown metadata without verified active turn evidence stays at its baseline and cannot wave', () => {
  const unverified: SpriteLifecycle[][] = [
    [],
    ['parent', 'child'].map(agentId => life(agentId, {
      turnId: null, status: null, phase: 'unknown', visible: null, meetingEligible: false,
    })),
  ];
  for (const lifecycles of unverified) {
    const current = input();
    for (const sourceAgent of current.snapshot!.agents) sourceAgent.runtimeState = 'unknown';
    current.lifecycles = lifecycles;
    const before = structuredClone(current.snapshot);
    const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
    for (const now of [0, 100, 10_000]) {
      const frame = controller.update(current, now);
      assert.equal(frame.checkIn, null);
      for (const pet of frame.placed) {
        assert.deepEqual(pet.point, current.layout.homes.get(pet.agent.agentId));
        assert.equal(pet.visualState, 'unknown');
        assert.equal(pet.animationName, undefined);
        assert.equal(pet.motion, 'settled');
        assert.strictEqual(pet.agent, current.snapshot!.agents.find(sourceAgent => sourceAgent.agentId === pet.agent.agentId));
      }
    }
    assert.deepEqual(current.snapshot, before);
  }
});

test('request records and request ids preempt verified-active unknown pets during a decorative wave', () => {
  for (const target of ['parent', 'child']) {
    for (const requestForm of ['record', 'id']) {
      const current = input();
      for (const sourceAgent of current.snapshot!.agents) sourceAgent.runtimeState = 'unknown';
      const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
      controller.update(current, 0);
      assert.ok(controller.update(current, 100).checkIn);
      if (requestForm === 'record') current.snapshot!.pendingRequests = [request(target)];
      else current.snapshot!.agents.find(sourceAgent => sourceAgent.agentId === target)!.pendingRequestIds = ['synthetic-request'];
      const before = structuredClone(current.snapshot);
      const attentionFrame = controller.update(current, 101);
      assert.equal(attentionFrame.checkIn, null, `${target}: ${requestForm}`);
      const requestedPet = attentionFrame.placed.find(pet => pet.agent.agentId === target)!;
      assert.equal(requestedPet.animationName, undefined);
      assert.deepEqual(requestedPet.point, current.layout.homes.get(target));
      assert.equal(controller.update(current, 10_000).checkIn, null);
      assert.deepEqual(current.snapshot, before);
    }
  }
});

test('verified active turns never override explicit waiting, error, or closed runtime metadata', () => {
  for (const runtimeState of ['waiting-for-input', 'waiting-for-approval', 'error', 'closed'] as const) {
    const current = input();
    current.snapshot!.agents[0].runtimeState = 'unknown';
    current.snapshot!.agents[1].runtimeState = runtimeState;
    const before = structuredClone(current.snapshot);
    const controller = createOfficeBehaviorController({ checkInIntervalMs: 100, checkInDurationMs: 20 });
    controller.update(current, 0);
    const frame = controller.update(current, 100);
    assert.equal(frame.checkIn, null, runtimeState);
    const child = frame.placed.find(pet => pet.agent.agentId === 'child');
    if (runtimeState === 'closed') assert.equal(child, undefined);
    else {
      assert.ok(child);
      assert.equal(child.visualState, runtimeState);
      assert.equal(child.agent.runtimeState, runtimeState);
      assert.deepEqual(child.point, current.layout.homes.get('child'));
      assert.equal(child.animationName, undefined);
    }
    assert.deepEqual(current.snapshot, before);
  }
});

function idleInput() {
  const current = input();
  for (const sourceAgent of current.snapshot!.agents) sourceAgent.runtimeState = 'idle';
  return current;
}

test('decorative small talk preserves its cadence on the shared clock without changing source activity', () => {
  const current = idleInput();
  const before = structuredClone(current);
  const controller = createOfficeBehaviorController();
  assert.equal(controller.update(current, 0).speech, null);
  assert.equal(controller.update(current, 1799).speech, null);
  const first = controller.update(current, 1800);
  assert.ok(first.speech);
  assert.ok(['parent', 'child'].includes(first.speech.agentId));
  assert.ok(first.speech.text.length > 0);
  assert.equal(first.checkIn, null);
  assert.equal(first.meeting, null);
  assert.deepEqual(first.completedMeetings, []);
  assert.deepEqual(first.completedLifecycles, []);
  assert.deepEqual(controller.update(current, 5299).speech, first.speech);
  assert.equal(controller.update(current, 5300).speech, null);
  assert.equal(controller.update(current, 8999).speech, null);
  assert.ok(controller.update(current, 9000).speech);
  assert.equal(controller.update(current, 12500).speech, null);
  assert.ok(controller.update(current, 18000).speech);
  assert.deepEqual(current, before);
});

test('small talk requires nearby idle rest pets and at least one child', () => {
  const changes: Array<[string, (current: OfficeBehaviorInput) => void]> = [
    ['two root pets', current => { current.snapshot!.agents[1].parentAgentId = null; }],
    ['distant pets', current => { current.rests = new Map([['parent', { x: 500, y: 600 }], ['child', { x: 651, y: 600 }]]); }],
    ['working pet', current => { current.snapshot!.agents[1].runtimeState = 'working'; }],
    ['unrendered pet', current => { current.visibleAgents = [current.snapshot!.agents[0]]; }],
  ];
  for (const [label, change] of changes) {
    const current = idleInput();
    change(current);
    const controller = createOfficeBehaviorController();
    controller.update(current, 0);
    assert.equal(controller.update(current, 1800).speech, null, label);
  }
  // Existing observed idle pets can chat without invented current-turn evidence.
  const current = idleInput();
  current.lifecycles = [];
  current.rests = new Map([['parent', { x: 500, y: 600 }], ['child', { x: 650, y: 600 }]]);
  const controller = createOfficeBehaviorController();
  controller.update(current, 0);
  assert.ok(controller.update(current, 1800).speech);
});

test('small talk yields immediately to requests, lifecycle motion, disconnection and real handoffs', () => {
  const changes: Array<[string, (current: OfficeBehaviorInput) => void]> = [
    ['lifecycle attention', current => { current.lifecycles = [life('parent', { attention: true }), life('child')]; }],
    ['request record', current => { current.snapshot!.pendingRequests = [request('parent')]; }],
    ['request id', current => { current.snapshot!.agents[0].pendingRequestIds = ['synthetic-request']; }],
    ['waiting state', current => { current.snapshot!.agents[0].runtimeState = 'waiting-for-input'; }],
    ['entering', current => { current.lifecycles = [life('parent', { phase: 'entering' }), life('child')]; }],
    ['leaving', current => { current.lifecycles = [life('parent', { phase: 'leaving', status: 'succeeded' }), life('child')]; }],
    ['sleeping', current => { current.lifecycles = [life('parent', { phase: 'sleeping', pose: 'sleeping', status: 'interrupted' }), life('child')]; }],
    ['dying', current => { current.lifecycles = [life('parent', { phase: 'dying', pose: 'dying', status: 'failed' }), life('child')]; }],
    ['transport disconnected', current => { current.transportConnected = false; }],
    ['source disconnected', current => { current.snapshot!.connection.status = 'disconnected'; }],
    ['presentation reset', current => { current.snapshot!.presentation = { state: 'ready', canSkip: false }; }],
    ['queued handoff', current => { current.realHandoffPending = true; }],
    ['active handoff', current => { current.meeting = meeting(); }],
  ];
  for (const [label, change] of changes) {
    const current = idleInput();
    const controller = createOfficeBehaviorController();
    controller.update(current, 0);
    assert.ok(controller.update(current, 1800).speech, label);
    change(current);
    assert.equal(controller.update(current, 1801).speech, null, label);
    assert.equal(controller.update(current, 3601).speech, null, label);
  }
});

test('an active decorative wave takes priority over idle small talk', () => {
  const current = idleInput();
  const controller = createOfficeBehaviorController({ checkInIntervalMs: 2000, checkInDurationMs: 500 });
  controller.update(current, 0);
  assert.ok(controller.update(current, 1800).speech);
  current.snapshot!.agents.push(agent('busy-child', 'parent'));
  current.lifecycles = [...current.lifecycles, life('busy-child')];
  current.layout = { ...current.layout, homes: new Map([...current.layout.homes, ['busy-child', { x: 1100, y: 200 }]]) };
  current.entrances = new Map([...current.entrances, ['busy-child', { x: 700, y: 700 }]]);
  current.standups = new Map([...current.standups, ['busy-child', { x: 700, y: 350 }]]);
  assert.ok(controller.update(current, 1801).speech);
  const waving = controller.update(current, 3800);
  assert.ok(waving.checkIn);
  assert.equal(waving.speech, null);
});

test('closed session sprite plays its accepted death at the previous position before disappearing', () => {
  const current = input();
  const behavior = createOfficeBehaviorController();
  const first = behavior.update(current, 0).placed.find(p => p.agent.agentId === 'parent')!;
  current.snapshot!.agents[0].runtimeState = 'closed';
  const token = { generation: 1, serial: 1, agentId: 'parent', turnId: 'session-close:event-1' };
  current.lifecycles = [life('parent', { phase: 'dying', pose: 'dying', token, meetingEligible: false }), life('child')];
  const dying = behavior.update(current, 1).placed.find(p => p.agent.agentId === 'parent')!;
  assert.equal(dying.animationName, 'failed');
  assert.deepEqual(dying.point, first.point);
  assert.deepEqual(behavior.update(current, 501).completedLifecycles, [token]);
  current.lifecycles = [life('parent', { phase: 'absent', pose: 'dead', visible: false, meetingEligible: false }), life('child')];
  assert.equal(behavior.update(current, 502).placed.some(p => p.agent.agentId === 'parent'), false);
});
