import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeEvent, OfficeSnapshot } from '../shared/contract';
import { createOfficeStore, RESYNC_REQUIRED } from './store';
import { agent, event, request, snapshot, time } from './test-helpers';

test('selection and real requests survive UI choices, scene reset, and metadata updates', () => {
  const store = createOfficeStore(snapshot());
  store.applyEvent(event(1, 'request.opened', { request: request('first') }));
  store.applyEvent(event(2, 'request.opened', { request: request('second') }));
  store.selectAgent('main');
  store.applyEvent(event(3, 'presentation.changed', { officeSessionId: 'new-scene', state: 'ready', canSkip: false }));
  store.applyEvent(event(4, 'agent.upserted', { agent: { ...agent(), task: 'New visible task' } }));
  assert.deepEqual(store.getState().snapshot!.agents[0].pendingRequestIds, ['first', 'second']);
  store.applyEvent(event(5, 'request.resolved', { requestId: 'first', reason: 'answered elsewhere' }));
  assert.deepEqual(store.getState().snapshot!.pendingRequests.map(r => r.requestId), ['second']);
  assert.deepEqual(store.getState().snapshot!.agents[0].pendingRequestIds, ['second']);
  assert.equal(store.getState().selectedAgentId, 'main');
  assert.equal(store.getState().snapshot!.pendingRequests[0].responseCapability.supported, false);
  assert.match(store.getState().snapshot!.pendingRequests[0].responseCapability.reason!, /unavailable|verified/);
});

test('wrong request owner cannot resolve another agent and unknown details remain unknown', () => {
  const initial = snapshot();
  initial.agents[0].runtimeState = 'waiting-for-input';
  initial.agents[0].pendingRequestIds = ['unknown-request'];
  const store = createOfficeStore(initial);
  assert.equal(store.getState().snapshot!.pendingRequests.length, 0);
  assert.equal(store.getState().snapshot!.agents[0].task, null);
  store.applyEvent(event(1, 'request.opened', { request: request() }));
  store.applyEvent(event(2, 'request.resolved', { requestId: 'request-1', reason: null }, { agentId: 'wrong-agent' }));
  assert.equal(store.getState().snapshot!.pendingRequests.length, 1);
  store.applyEvent(event(3, 'request.resolved', { requestId: 'unknown-request', reason: 'cancelled' }));
  assert.deepEqual(store.getState().snapshot!.agents[0].pendingRequestIds, ['request-1']);
});

test('store snapshots are immutable and subscriptions remain stable until a real update', () => {
  const input = snapshot();
  const store = createOfficeStore(input);
  const before = store.getState();
  input.agents[0].displayName = 'outside mutation';
  assert.equal(before.snapshot!.agents[0].displayName, 'main');
  assert.throws(() => { before.snapshot!.agents[0].pendingRequestIds.push('bad'); }, TypeError);
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'idle' }));
  const after = store.getState();
  store.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'error' }));
  assert.equal(store.getState(), after);
  assert.equal(updates, 1);
  assert.equal(before.snapshot!.agents[0].runtimeState, 'working');
  unsubscribe();
  store.selectAgent('main');
  assert.equal(updates, 1);
});

test('deduplicates replay and activity IDs while keeping activity on the correct pet', () => {
  const store = createOfficeStore(snapshot());
  const activity = { activityId: 'tool-a', agentId: 'main', kind: 'reading' as const, summary: 'Read the design', occurredAt: time,
    sourceItemId: 'item-a', source: 'fixture' as const };
  store.applyEvent(event(1, 'agent.activity', { activity }));
  store.applyEvent(event(1, 'agent.activity', { activity }));
  store.applyEvent(event(2, 'agent.activity', { activity }));
  store.applyEvent(event(3, 'agent.activity', { activity: { ...activity, activityId: 'tool-b' } }, { eventId: 'event-2' }));
  assert.equal(store.getState().snapshot!.agents[0].recentActivity.length, 1);
  assert.equal(store.getState().snapshot!.lastSeq, 3);
});

test('sequence gap requires a snapshot; stale snapshots cannot overwrite newer events', () => {
  const store = createOfficeStore(snapshot());
  store.selectAgent('main');
  store.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'idle' }));
  store.applySnapshot(snapshot(0));
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'idle');
  store.applyEvent(event(3, 'agent.state.changed', { runtimeState: 'error' }));
  assert.equal(store.getState().error, RESYNC_REQUIRED);
  assert.equal(store.getState().snapshot!.lastSeq, 1);
  store.applySnapshot(snapshot(1));
  assert.equal(store.getState().error, RESYNC_REQUIRED, 'a snapshot predating the known gap cannot complete resync');
  store.applySnapshot(snapshot(3));
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().selectedAgentId, 'main');
  store.applyEvent(event(4, 'agent.state.changed', { runtimeState: 'idle' }));
  assert.equal(store.getState().snapshot!.lastSeq, 4);
});

test('bridge restart waits for the matching snapshot and ignores a retired epoch', () => {
  const store = createOfficeStore(snapshot(20));
  store.applyEvent(event(1, 'agent.state.changed', { runtimeState: 'idle' }, { bridgeEpoch: 'epoch-b' }));
  store.applySnapshot(snapshot(21));
  assert.equal(store.getState().error, RESYNC_REQUIRED);
  store.applySnapshot(snapshot(1, 'epoch-b'));
  const current = store.getState();
  store.applySnapshot(snapshot(100));
  store.applyEvent(event(101, 'agent.state.changed', { runtimeState: 'error' }));
  assert.equal(store.getState(), current);
});

test('bridge and transport failure never mark agents complete, closed or failed', () => {
  const store = createOfficeStore(snapshot());
  store.applyEvent(event(1, 'connection.changed', { connection: { status: 'disconnected', lastObservedAt: time, message: 'Source offline' } }));
  store.setTransportStatus('disconnected', 'Browser offline');
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  assert.equal(store.getState().snapshot!.connection.message, 'Source offline');
  store.applyEvent(event(2, 'agent.work.completed', { sourceItemId: 'turn-completed' }));
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  store.applyEvent(event(3, 'agent.closed', { reason: 'Source closed' }));
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'closed');
});

test('corrupt snapshots/events leave existing state data intact and expose an error', () => {
  const store = createOfficeStore(snapshot());
  store.applySnapshot({ protocolVersion: 1, agents: null } as unknown as OfficeSnapshot);
  assert.match(store.getState().error!, /Invalid office snapshot/);
  assert.equal(store.getState().snapshot!.lastSeq, 0);
  store.applyEvent({ ...event(1, 'agent.state.changed', { runtimeState: 'idle' }), data: null } as unknown as OfficeEvent);
  assert.match(store.getState().error!, /Invalid office event/);
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
});
