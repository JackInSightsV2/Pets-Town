import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeHandoff, OfficeSnapshot } from '../shared/contract';
import type { TurnLifecycleObservation } from '../shared/turn-lifecycle';
import { createLifecycleStore } from './lifecycle';
import { createHandoffStore } from './handoffs';
import { agent, event, request, snapshot, time } from './test-helpers';

function observation(status: TurnLifecycleObservation['status'], turn = 1, delivery: TurnLifecycleObservation['delivery'] = 'live'): TurnLifecycleObservation {
  const statusId = { started: '1', succeeded: '2', failed: '3', interrupted: '4' }[status];
  return { agentId: 'main', turnId: `turn-v1-${turn.toString(16).padStart(64, '0')}`,
    sourceEventId: `turn-event-v1-${`${turn.toString(16)}${statusId}`.padStart(64, '0')}`,
    status, source: 'fixture', delivery, occurredAt: time, startedAt: turn };
}
function live(seq = 0, epoch = 'epoch-a', latestTurns: TurnLifecycleObservation[] = [observation('started', 1, 'history')]): OfficeSnapshot {
  return { ...snapshot(seq, epoch), presentation: { state: 'live', canSkip: false }, latestTurns };
}

test('accepted snapshots seed lifecycle before transport onopen and never replay history', () => {
  const store = createLifecycleStore();
  store.setTransportStatus('reconnecting');
  store.applySnapshot(live(0, 'epoch-a', [observation('interrupted', 1, 'history')]));
  assert.equal(store.getState().transport.status, 'reconnecting');
  assert.equal(store.getLifecycleState().sprites[0].phase, 'sleeping');
  assert.equal(store.getLifecycleState().sprites[0].token, null);
  store.setTransportStatus('connected');
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('started', 2) }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'present');
  assert.ok(store.getLifecycleState().sprites[0].token, 'new work wakes after the accepted baseline');
});

test('office and lifecycle subscribers see coherent accepted views with stable immutable snapshots', () => {
  const store = createLifecycleStore(live());
  const before = store.getLifecycleState();
  const observed: string[] = [];
  store.subscribe(() => observed.push(`${store.getState().snapshot!.lastSeq}:${store.getLifecycleState().sprites[0].phase}`));
  let lifecycleUpdates = 0;
  store.subscribeLifecycle(() => lifecycleUpdates++);
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('succeeded') }));
  assert.deepEqual(observed, ['1:leaving']);
  assert.equal(lifecycleUpdates, 1);
  const after = store.getLifecycleState();
  assert.notEqual(before, after);
  assert.equal(store.getLifecycleState(), after);
  assert.throws(() => { after.sprites[0].phase = 'present'; }, TypeError);
  store.selectAgent('main');
  assert.equal(store.getLifecycleState(), after);
  assert.equal(lifecycleUpdates, 1);
});

test('a reused accepted envelope id advances sequence without applying a changed lifecycle payload', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'idle' }));
  const before = store.getLifecycleState();
  store.applyEvent(event(2, 'agent.turn.observed', { observation: observation('succeeded') }, { eventId: 'event-1' }));
  assert.equal(store.getState().snapshot!.lastSeq, 2);
  assert.equal(store.getLifecycleState(), before);
  assert.equal(store.getLifecycleState().sprites[0].phase, 'present');
});

test('sequence gaps suspend callbacks and only an accepted authoritative snapshot resumes lifecycle', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed') }));
  const token = store.getLifecycleState().sprites[0].token!;
  store.applyEvent(event(3, 'agent.turn.observed', { observation: observation('started', 2) }));
  assert.ok(store.getState().error);
  assert.equal(store.completeLifecycle(token), false);
  assert.equal(store.getLifecycleState().sprites[0].phase, 'absent');
  store.applySnapshot(live(1));
  assert.equal(store.getLifecycleState().snapshotRevision, 1, 'stale replacement cannot clear the gap');
  store.setTransportStatus('connected');
  store.applyEvent(event(2, 'agent.turn.observed', { observation: observation('started', 2) }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'absent');
  store.applySnapshot(live(3, 'epoch-a', [observation('started', 2, 'history')]));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'present');
  assert.equal(store.getLifecycleState().sprites[0].token, null);
  store.applyEvent(event(4, 'agent.turn.observed', { observation: observation('succeeded', 2) }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'leaving');
});

test('transport loss preserves known outcome and a connected flag cannot resume live delivery', () => {
  const store = createLifecycleStore(live());
  store.setTransportStatus('disconnected');
  assert.equal(store.getLifecycleState().sprites[0].status, 'started');
  assert.equal(store.getLifecycleState().sprites[0].meetingEligible, false);
  store.setTransportStatus('connected');
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed') }));
  assert.equal(store.getLifecycleState().sprites[0].status, 'started');
  store.applySnapshot(live(1, 'epoch-a', [observation('failed', 1, 'history')]));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'absent');
  assert.equal(store.getLifecycleState().sprites[0].token, null);
});

test('source connection recovery also requires a fresh baseline', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'connection.changed', { connection: { status: 'disconnected', lastObservedAt: time, message: null } }));
  store.applyEvent(event(2, 'connection.changed', { connection: { status: 'connected', lastObservedAt: time, message: null } }));
  store.applyEvent(event(3, 'agent.turn.observed', { observation: observation('succeeded') }));
  assert.equal(store.getLifecycleState().sprites[0].status, 'started');
  assert.equal(store.getLifecycleState().sprites[0].meetingEligible, false);
});

test('retired epochs and old sequences cannot change lifecycle or snapshot revision', () => {
  const store = createLifecycleStore(live(5));
  store.applySnapshot(live(2, 'epoch-b', [observation('started', 2, 'history')]));
  const before = store.getLifecycleState();
  store.applySnapshot(live(9));
  store.applyEvent(event(10, 'agent.turn.observed', { observation: observation('succeeded') }));
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed', 2) }, { bridgeEpoch: 'epoch-b' }));
  assert.equal(store.getLifecycleState(), before);
  assert.equal(store.getLifecycleState().sprites[0].status, 'started');
});

test('same-session authoritative replacement increments revision and invalidates animation callbacks', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed') }));
  const token = store.getLifecycleState().sprites[0].token!;
  store.applySnapshot(live(1, 'epoch-a', [observation('failed', 1, 'history')]));
  assert.equal(store.getLifecycleState().snapshotRevision, 2);
  assert.equal(store.getLifecycleState().sprites[0].phase, 'absent');
  assert.equal(store.getLifecycleState().sprites[0].token, null);
  assert.equal(store.completeLifecycle(token), false);
});

test('request records alone pin attention and cancel exit without replay', () => {
  const initial = live(0, 'epoch-a', [observation('succeeded', 1, 'history')]);
  initial.pendingRequests = [request()];
  const store = createLifecycleStore(initial);
  assert.deepEqual(store.getState().snapshot!.agents[0].pendingRequestIds, ['request-1']);
  assert.equal(store.getLifecycleState().sprites[0].attention, true);
  assert.equal(store.getLifecycleState().sprites[0].visible, true);
  store.applyEvent(event(1, 'request.resolved', { requestId: 'request-1', reason: null }));
  assert.equal(store.getLifecycleState().sprites[0].visible, false);
  store.applyEvent(event(2, 'agent.turn.observed', { observation: observation('started', 2) }));
  store.completeLifecycle(store.getLifecycleState().sprites[0].token!);
  store.applyEvent(event(3, 'agent.turn.observed', { observation: observation('succeeded', 2) }));
  const token = store.getLifecycleState().sprites[0].token!;
  store.applyEvent(event(4, 'request.opened', { request: request('later') }));
  assert.equal(store.getLifecycleState().sprites[0].visible, true);
  assert.equal(store.getLifecycleState().sprites[0].attention, true);
  assert.equal(store.completeLifecycle(token), false);
});

test('unknown runtime metadata and work completion never manufacture turn outcomes', () => {
  const store = createLifecycleStore(live(0, 'epoch-a', []));
  for (const [index, runtimeState] of (['idle', 'error', 'unknown'] as const).entries()) {
    store.applyEvent(event(index + 1, 'agent.state.changed', { runtimeState }));
  }
  store.applyEvent(event(4, 'agent.work.completed', { sourceItemId: 'synthetic-work' }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'unknown');
  assert.equal(store.getLifecycleState().sprites[0].visible, null);
  assert.equal(store.getLifecycleState().sprites[0].token, null);
  store.setTransportStatus('disconnected');
  assert.equal(store.getLifecycleState().sprites[0].status, null);
});

test('presentation session changes cancel tokens even when the new presentation is already live', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed') }));
  const token = store.getLifecycleState().sprites[0].token!;
  store.applyEvent(event(2, 'presentation.changed', { officeSessionId: 'new-session', state: 'live', canSkip: false }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'absent');
  assert.equal(store.completeLifecycle(token), false);
  store.applyEvent(event(3, 'agent.turn.observed', { observation: observation('started', 2) }));
  assert.equal(store.getLifecycleState().sprites[0].phase, 'entering');
});

test('new work invalidates a prior completion token without changing runtime membership', () => {
  const store = createLifecycleStore(live());
  store.selectAgent('main');
  store.applyEvent(event(1, 'agent.turn.observed', { observation: observation('failed') }));
  const previous = store.getLifecycleState().sprites[0].token!;
  store.applyEvent(event(2, 'agent.turn.observed', { observation: observation('started', 2) }));
  assert.equal(store.completeLifecycle(previous), false);
  assert.equal(store.getLifecycleState().sprites[0].visible, true);
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  assert.equal(store.getState().selectedAgentId, 'main');
});

test('invalid input suspends motion without publishing an invalid lifecycle observation', () => {
  const store = createLifecycleStore(live());
  store.applyEvent(event(1, 'agent.turn.observed', { observation: { ...observation('failed'), turnId: 'raw-unverified-turn' } }));
  assert.ok(store.getState().error);
  assert.equal(store.getLifecycleState().sprites[0].status, 'started');
  assert.equal(store.getLifecycleState().sprites[0].token, null);
  const revision = store.getLifecycleState().snapshotRevision;
  store.applySnapshot({ ...live(), latestTurns: [{ ...observation('failed'), agentId: '' }] });
  assert.equal(store.getLifecycleState().snapshotRevision, revision);
});

const meetingAgents = ['main', 'child', 'other', 'other-child'];
function composedMeetings(knownTurns = true, renderedIds: readonly string[] = meetingAgents) {
  const lifecycle = createLifecycleStore();
  const store = createHandoffStore({ store: lifecycle, getEligibleAgentIds: () => lifecycle.getLifecycleState().sprites
    .filter(sprite => !sprite.attention && (sprite.phase === 'unknown' || sprite.meetingEligible)).map(sprite => sprite.agentId) });
  const initial = live(0, 'epoch-a', knownTurns ? meetingAgents.map((agentId, index) =>
    ({ ...observation('started', index + 1, 'history'), agentId })) : []);
  initial.agents = meetingAgents.map(agentId => ({ ...agent(agentId), runtimeState: knownTurns ? 'working' as const : 'unknown' as const }));
  initial.capabilities.observeHandoffs = { supported: true, reason: null };
  // This is the scene's actual rendered set, separately from lifecycle eligibility.
  store.setVisibleAgents(renderedIds);
  store.applySnapshot(initial);
  store.setTransportStatus('connected');
  return { lifecycle, store };
}
function observedMeeting(seq: number, handoffId: string, fromAgentId = 'main', toAgentId = 'child') {
  const handoff: OfficeHandoff = { handoffId, fromAgentId, toAgentId, summary: 'Synthetic observed message',
    occurredAt: time, sourceItemId: `item-${handoffId}` };
  return event(seq, 'handoff.observed', { handoff }, { agentId: fromAgentId });
}

for (const [status, phase] of [['succeeded', 'leaving'], ['failed', 'dying'], ['interrupted', 'sleeping']] as const) {
  test(`composed ${status} lifecycle cancels active and queued meetings without hidden signals`, () => {
    const { lifecycle, store } = composedMeetings();
    store.applyEvent(observedMeeting(1, 'active'));
    const cancelled = store.getMeetingState().active!.token;
    store.applyEvent(observedMeeting(2, 'queued-same-pair'));
    store.applyEvent(observedMeeting(3, 'unrelated', 'other', 'other-child'));
    store.applyEvent(event(4, 'agent.turn.observed', { observation: observation(status) }));
    assert.equal(lifecycle.getLifecycleState().sprites.find(sprite => sprite.agentId === 'main')!.phase, phase);
    assert.equal(store.getMeetingState().active?.handoff.handoffId, 'unrelated');
    assert.deepEqual(store.getMeetingState().queued, []);
    assert.deepEqual(store.getMeetingState().hiddenSignals, []);
    assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working', 'presentation does not rewrite source runtime state');
    store.completeMeeting(cancelled);
    assert.equal(store.getMeetingState().active?.handoff.handoffId, 'unrelated', 'stale return callback cannot end the next pair');
    const dropped = store.getMeetingState().dropped;
    store.applyEvent(observedMeeting(5, 'ineligible-new'));
    assert.equal(store.getMeetingState().dropped, dropped + 1);
    assert.deepEqual(store.getMeetingState().queued, []);
    assert.deepEqual(store.getMeetingState().hiddenSignals, []);
  });
}

test('composed request attention cancels active and queued meetings and later resolution does not replay them', () => {
  const { lifecycle, store } = composedMeetings();
  store.applyEvent(observedMeeting(1, 'active'));
  const cancelled = store.getMeetingState().active!.token;
  store.applyEvent(observedMeeting(2, 'queued-attention-pair'));
  store.applyEvent(observedMeeting(3, 'unrelated', 'other', 'other-child'));
  store.applyEvent(event(4, 'request.opened', { request: request('attention') }));
  const main = lifecycle.getLifecycleState().sprites.find(sprite => sprite.agentId === 'main')!;
  assert.equal(main.attention, true);
  assert.equal(main.status, 'started');
  assert.equal(main.visible, true);
  assert.equal(store.getMeetingState().active?.handoff.handoffId, 'unrelated');
  assert.deepEqual(store.getMeetingState().queued, []);
  assert.deepEqual(store.getMeetingState().hiddenSignals, []);
  store.applyEvent(event(5, 'request.resolved', { requestId: 'attention', reason: null }));
  store.applyEvent(observedMeeting(6, 'active'));
  store.applyEvent(observedMeeting(7, 'queued-attention-pair'));
  assert.deepEqual(store.getMeetingState().queued, [], 'cancelled observed messages stay deduplicated');
  store.completeMeeting(cancelled);
  assert.equal(store.getMeetingState().active?.handoff.handoffId, 'unrelated');
  store.applyEvent(observedMeeting(8, 'fresh-after-attention'));
  assert.deepEqual(store.getMeetingState().queued.map(handoff => handoff.handoffId), ['fresh-after-attention']);
  store.completeMeeting(store.getMeetingState().active!.token);
  assert.equal(store.getMeetingState().active?.handoff.handoffId, 'fresh-after-attention');
});

test('composed lifecycle removes an ineligible hidden queued handoff without blocking a rendered pair', () => {
  const { store } = composedMeetings(true, ['main', 'other', 'other-child']);
  store.applyEvent(observedMeeting(1, 'hidden-child'));
  assert.equal(store.getMeetingState().active, null);
  assert.deepEqual(store.getMeetingState().queued.map(handoff => handoff.handoffId), ['hidden-child']);
  assert.deepEqual(store.getMeetingState().hiddenSignals[0].hiddenAgentIds, ['child']);
  store.applyEvent(event(2, 'agent.turn.observed', { observation: { ...observation('interrupted', 2), agentId: 'child' } }, { agentId: 'child' }));
  assert.deepEqual(store.getMeetingState().queued, []);
  assert.deepEqual(store.getMeetingState().hiddenSignals, []);
  store.applyEvent(observedMeeting(3, 'rendered-pair', 'other', 'other-child'));
  assert.equal(store.getMeetingState().active?.handoff.handoffId, 'rendered-pair');
});

test('explicit handoffs remain available without lifecycle history and never infer a turn outcome', () => {
  const { lifecycle, store } = composedMeetings(false);
  const unknown = lifecycle.getLifecycleState();
  assert.ok(unknown.sprites.every(sprite => sprite.phase === 'unknown' && sprite.status === null
    && sprite.visible === null && !sprite.meetingEligible && sprite.token === null));
  store.applyEvent(observedMeeting(1, 'explicit-unknown'));
  const active = store.getMeetingState().active!;
  assert.equal(active.handoff.handoffId, 'explicit-unknown');
  store.applyEvent(observedMeeting(2, 'next-explicit-unknown'));
  store.completeMeeting(active.token);
  assert.equal(store.getMeetingState().active?.handoff.handoffId, 'next-explicit-unknown');
  assert.equal(lifecycle.getLifecycleState(), unknown);
  assert.ok(store.getState().snapshot!.agents.every(candidate => candidate.runtimeState === 'unknown'));
  assert.deepEqual(store.getMeetingState().hiddenSignals, []);
});

test('only accepted live session closure plays one death and never invents a turn failure', () => {
  const initial = live();
  const store = createLifecycleStore(initial);
  store.applyEvent(event(1, 'agent.closed', { reason: null }));
  const dying = store.getLifecycleState().sprites[0];
  assert.equal(dying.phase, 'dying');
  assert.equal(dying.status, 'started');
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'closed');
  assert.deepEqual(store.getState().snapshot!.latestTurns, initial.latestTurns);
  store.applyEvent(event(2, 'agent.closed', { reason: null }));
  assert.deepEqual(store.getLifecycleState().sprites[0].token, dying.token);
  assert.equal(store.completeLifecycle(dying.token!), true);
  assert.equal(store.getLifecycleState().sprites[0].visible, false);
  assert.equal(store.completeLifecycle(dying.token!), false);

  const historical = createLifecycleStore({ ...initial, agents: initial.agents.map(a => ({ ...a, runtimeState: 'closed' })) });
  assert.equal(historical.getLifecycleState().sprites[0].phase, 'absent');
  assert.equal(historical.getLifecycleState().sprites[0].token, null);
  const stale = createLifecycleStore(initial);
  stale.setTransportStatus('disconnected');
  stale.applyEvent(event(1, 'agent.closed', { reason: null }));
  assert.notEqual(stale.getLifecycleState().sprites[0].phase, 'dying');
  const gap = createLifecycleStore(initial);
  gap.applyEvent(event(2, 'agent.closed', { reason: null }));
  assert.notEqual(gap.getLifecycleState().sprites[0].phase, 'dying');
  const metadata = createLifecycleStore(initial);
  metadata.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'closed' }));
  assert.notEqual(metadata.getLifecycleState().sprites[0].phase, 'dying');
});
