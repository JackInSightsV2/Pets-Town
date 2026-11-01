import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot, type OfficeAgent, type OfficeRequest, type PetAsset, type RuntimeState } from '../../shared/contract';
import {
  CHECK_IN_DURATION_MS, CHECK_IN_INTERVAL_MS, checkInAnimationName, createCheckInController,
  type CheckInInput,
} from './controller';

const agent = (agentId: string, parentAgentId: string | null = null, runtimeState: RuntimeState = 'working'): OfficeAgent => ({
  agentId, parentAgentId, projectId: 'synthetic-project', displayName: agentId, role: null, task: 'Synthetic work',
  runtimeState, activityKind: 'editing', lastObservedAt: null, pendingRequestIds: [], petAssetId: 'synthetic-pet', recentActivity: [],
});
const request = (agentId: string): OfficeRequest => ({
  requestId: 'synthetic-request', agentId, kind: 'user-input', prompt: 'Synthetic question', options: [],
  createdAt: '2026-11-01T12:00:00.000Z', responseCapability: { supported: false, reason: 'Observation only' }, revision: null,
});
const asset: PetAsset = {
  assetId: 'synthetic-pet', name: 'Synthetic atlas', imageUrl: '/synthetic-atlas.png', origin: 'codex',
  width: 80, height: 40, columns: 4, rows: 2,
  animations: { idle: { row: 0, frames: 4, fps: 4 }, waving: { row: 1, frames: 4, fps: 4 } },
};
function input(agents = [agent('parent'), agent('child', 'parent')]): CheckInInput {
  const snapshot = emptySnapshot('synthetic-epoch');
  snapshot.officeSessionId = 'synthetic-office';
  snapshot.presentation = { state: 'live', canSkip: false };
  snapshot.connection = { status: 'connected', lastObservedAt: null, message: null };
  snapshot.agents = agents;
  return { snapshot, transportConnected: true, visibleAgentIds: agents.map(item => item.agentId), reservedAgentIds: [], realHandoffPending: false };
}
const fast = () => createCheckInController({ intervalMs: 100, durationMs: 20 });
function start(current = input()) {
  const controller = fast();
  assert.equal(controller.update(current, 0), null);
  const active = controller.update(current, 100);
  assert.ok(active);
  return { controller, current, active };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('first check-in waits for the default cadence and polling preserves its finite deadline', () => {
  const controller = createCheckInController();
  const current = input();
  assert.equal(controller.update(current, 500), null);
  assert.equal(controller.update(current, 500 + CHECK_IN_INTERVAL_MS - 1), null);
  const active = controller.update(current, 500 + CHECK_IN_INTERVAL_MS);
  assert.ok(active);
  assert.equal(active.endsAt, active.startedAt + CHECK_IN_DURATION_MS);
  assert.deepEqual(controller.update(structuredClone(current), active.endsAt - 1), active);
  assert.equal(controller.update(current, active.endsAt), null);
});

test('input reordering preserves deterministic fair sibling and family order', () => {
  const agents = [agent('parent-b'), agent('child-b', 'parent-a'), agent('parent-a'), agent('child-a', 'parent-a'), agent('child-c', 'parent-b')];
  const forward = fast();
  const reversed = fast();
  const first = input(agents);
  const second = input([...agents].reverse());
  second.visibleAgentIds = [...second.visibleAgentIds].reverse();
  forward.update(first, 0);
  reversed.update(second, 0);
  const observed: string[] = [];
  for (let index = 0; index < 4; index++) {
    const now = 100 + index * 120;
    const left = forward.update(first, now);
    const right = reversed.update(second, now);
    assert.ok(left);
    assert.deepEqual(left, right);
    observed.push(`${left.parentAgentId}/${left.childAgentId}`);
    assert.equal(forward.update(first, now + 20), null);
    assert.equal(reversed.update(second, now + 20), null);
  }
  assert.deepEqual(observed, ['parent-a/child-a', 'parent-a/child-b', 'parent-b/child-c', 'parent-a/child-a']);
});

test('long clock gaps end the old run without catch-up bursts and impose a fresh cooldown', () => {
  const { controller, current } = start();
  assert.equal(controller.update(current, 10_000), null);
  assert.equal(controller.update(current, 10_000), null);
  assert.equal(controller.update(current, 10_099), null);
  const next = controller.update(current, 10_100);
  assert.ok(next);
  assert.equal(next.startedAt, 10_100);
  assert.equal(next.endsAt, 10_120);
});

test('early completion starts a full cooldown and cannot be repeated', () => {
  const { controller, current, active } = start();
  assert.equal(controller.complete(active.token, 105), true);
  assert.equal(controller.complete(active.token, 105), false);
  assert.equal(controller.update(current, 204), null);
  assert.ok(controller.update(current, 205));
});

test('only observed parent relations with a working child can start', () => {
  const excluded = [
    [agent('parent'), agent('child')],
    [agent('child', 'missing-parent')],
    [agent('self', 'self')],
    [agent('parent'), agent('child', 'parent', 'idle')],
    [agent('parent'), agent('child', 'parent', 'unknown')],
  ];
  for (const agents of excluded) {
    const controller = fast();
    const current = input(agents);
    assert.equal(controller.update(current, 0), null);
    assert.equal(controller.update(current, 100_000), null);
  }
  assert.ok(start(input([agent('parent', null, 'idle'), agent('child', 'parent')])).active);
});

test('both participants must be actual rendered pets and free from lifecycle reservations', () => {
  for (const id of ['parent', 'child']) {
    for (const blockedBy of ['hidden', 'reserved'] as const) {
      const controller = fast();
      const current = input();
      if (blockedBy === 'hidden') current.visibleAgentIds = current.visibleAgentIds.filter(value => value !== id);
      else current.reservedAgentIds = [id];
      assert.equal(controller.update(current, 0), null);
      assert.equal(controller.update(current, 10_000), null, `${id}: ${blockedBy}`);
    }
  }
});

test('request IDs, request records, and waiting states each block and cancel either participant', () => {
  for (const id of ['parent', 'child']) {
    for (const attention of ['request-id', 'request-record', 'waiting-for-input', 'waiting-for-approval'] as const) {
      const { controller, current, active } = start();
      const blocked = structuredClone(current);
      const target = blocked.snapshot!.agents.find(item => item.agentId === id)!;
      if (attention === 'request-id') target.pendingRequestIds = ['synthetic-request'];
      else if (attention === 'request-record') blocked.snapshot!.pendingRequests.push(request(id));
      else target.runtimeState = attention;
      assert.equal(controller.update(blocked, 101), null, `${id}: ${attention}`);
      assert.equal(controller.complete(active.token, 102), false);
      assert.equal(controller.update(blocked, 10_000), null);
      assert.equal(controller.update(current, 10_001), null);
      assert.ok(controller.update(current, 10_100));
    }
  }
});

test('attention on an unrelated agent does not suppress an eligible pair', () => {
  const current = input([agent('parent'), agent('child', 'parent'), agent('unrelated')]);
  current.snapshot!.pendingRequests.push(request('unrelated'));
  current.snapshot!.agents[2].runtimeState = 'waiting-for-input';
  assert.ok(start(current).active);
});

test('real handoffs preempt a check-in and hold decoration until a fresh cooldown', () => {
  const { controller, current, active } = start();
  const handoff = { ...current, realHandoffPending: true };
  assert.equal(controller.update(handoff, 101), null);
  assert.equal(controller.complete(active.token, 102), false);
  assert.equal(controller.update(handoff, 1_000), null);
  assert.equal(controller.update(current, 1_099), null);
  assert.ok(controller.update(current, 1_100));
});

test('lifecycle reservation, hiding, removal, status, and reparenting cancel without immediate replacement', () => {
  const changes: Array<[string, (current: CheckInInput) => void]> = [
    ['parent reserved', current => { current.reservedAgentIds = ['parent']; }],
    ['child reserved', current => { current.reservedAgentIds = ['child']; }],
    ['parent hidden', current => { current.visibleAgentIds = ['child']; }],
    ['child hidden', current => { current.visibleAgentIds = ['parent']; }],
    ['parent removed', current => { current.snapshot!.agents = current.snapshot!.agents.filter(item => item.agentId !== 'parent'); }],
    ['child removed', current => { current.snapshot!.agents = current.snapshot!.agents.filter(item => item.agentId !== 'child'); }],
    ['child idle', current => { current.snapshot!.agents[1].runtimeState = 'idle'; }],
    ['child reparented', current => {
      current.snapshot!.agents.push(agent('new-parent'));
      current.visibleAgentIds = [...current.visibleAgentIds, 'new-parent'];
      current.snapshot!.agents[1].parentAgentId = 'new-parent';
    }],
  ];
  for (const id of ['parent', 'child']) {
    for (const state of ['error', 'closed', 'unknown'] as const) {
      changes.push([`${id} ${state}`, current => { current.snapshot!.agents.find(item => item.agentId === id)!.runtimeState = state; }]);
    }
  }
  for (const [label, change] of changes) {
    const { controller, current, active } = start();
    change(current);
    assert.equal(controller.update(current, 101), null, label);
    assert.equal(controller.getState(), null, label);
    assert.equal(controller.complete(active.token, 102), false, label);
  }
});

test('source, transport, and presentation unavailability cancel and block check-ins', () => {
  const changes: Array<[string, (current: CheckInInput) => void]> = [
    ['no snapshot', current => { current.snapshot = null; }],
    ['transport unavailable', current => { current.transportConnected = false; }],
  ];
  for (const status of ['disconnected', 'reconnecting', 'unsupported'] as const) {
    changes.push([`source ${status}`, current => { current.snapshot!.connection.status = status; }]);
  }
  for (const state of ['ready', 'arrivals', 'standup'] as const) {
    changes.push([`presentation ${state}`, current => { current.snapshot!.presentation.state = state; }]);
  }
  for (const [label, change] of changes) {
    const { controller, current, active } = start();
    const blocked = structuredClone(current);
    change(blocked);
    assert.equal(controller.update(blocked, 101), null, label);
    assert.equal(controller.complete(active.token, 102), false, label);
    assert.equal(controller.update(blocked, 10_000), null, label);
    assert.equal(controller.update(current, 10_001), null, label);
  }
});

test('session or epoch replacement restarts cadence and invalidates the old token', () => {
  for (const field of ['officeSessionId', 'bridgeEpoch'] as const) {
    const { controller, current, active } = start();
    current.snapshot![field] = `synthetic-next-${field}`;
    assert.equal(controller.update(current, 101), null);
    assert.equal(controller.complete(active.token, 102), false);
    assert.equal(controller.update(current, 200), null);
    const next = controller.update(current, 201);
    assert.ok(next);
    assert.notEqual(next.token.generation, active.token.generation);
  }
});

test('explicit reset clears context and stale callbacks cannot end a newer run', () => {
  const { controller, current, active } = start();
  controller.reset();
  assert.equal(controller.getState(), null);
  assert.equal(controller.complete(active.token, 101), false);
  assert.equal(controller.update(current, 101), null);
  const next = controller.update(current, 201);
  assert.ok(next);
  assert.notDeepEqual(next.token, active.token);
  assert.equal(controller.complete(active.token, 202), false);
  assert.deepEqual(controller.getState(), next);
  assert.equal(controller.complete({ ...next.token, serial: next.token.serial + 1 }, 202), false);
  assert.deepEqual(controller.getState(), next);
  assert.equal(controller.complete(next.token, 202), true);
});

test('old callbacks after normal completion cannot affect a later run', () => {
  const { controller, current, active } = start();
  assert.equal(controller.update(current, 120), null);
  const next = controller.update(current, 220);
  assert.ok(next);
  assert.equal(controller.complete(active.token, 221), false);
  assert.deepEqual(controller.getState(), next);
});

test('frozen office truth remains untouched and returned tokens cannot mutate controller state', () => {
  const current = freeze(input());
  const before = structuredClone(current);
  const { controller, active } = start(current);
  const expected = structuredClone(active);
  active.token.serial = 999;
  active.parentAgentId = 'not-observed';
  active.endsAt = Infinity;
  const state = controller.getState()!;
  assert.deepEqual(state, expected);
  state.token.generation = 999;
  state.childAgentId = 'not-observed';
  assert.deepEqual(controller.update(current, 110), expected);
  assert.equal(controller.update(current, 120), null);
  assert.deepEqual(current, before);
  assert.deepEqual(current.snapshot!.agents.map(item => item.recentActivity), [[], []]);
  assert.deepEqual(current.snapshot!.pendingRequests, []);
});

test('input references are not retained as active pair state', () => {
  const { controller, current, active } = start();
  current.snapshot!.agents[0].agentId = 'changed-after-delivery';
  current.snapshot!.agents[1].parentAgentId = 'changed-after-delivery';
  current.visibleAgentIds = [];
  assert.deepEqual(controller.getState(), active);
  assert.equal(controller.update(current, 101), null);
});

test('existing waving animation applies only to this pair and respects reduced motion and missing atlases', () => {
  const { active } = start();
  assert.equal(checkInAnimationName(active, 'parent', asset, false), 'waving');
  assert.equal(checkInAnimationName(active, 'child', asset, false), 'waving');
  assert.equal(checkInAnimationName(active, 'unrelated', asset, false), undefined);
  assert.equal(checkInAnimationName(active, 'parent', asset, true), undefined);
  assert.equal(checkInAnimationName(null, 'parent', asset, false), undefined);
  assert.equal(checkInAnimationName(active, 'parent', { ...asset, animations: { idle: asset.animations.idle } }, false), undefined);
});

test('clock and timing options reject invalid values and accept equal monotonic timestamps', () => {
  for (const value of [-1, 0, NaN, Infinity, -Infinity]) {
    assert.throws(() => createCheckInController({ intervalMs: value }), RangeError);
    assert.throws(() => createCheckInController({ durationMs: value }), RangeError);
  }
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => fast().update(input(), value), RangeError);
  }
  const { controller, current, active } = start();
  assert.deepEqual(controller.update(current, 100), active);
  assert.throws(() => controller.update(current, 99), RangeError);
  assert.throws(() => controller.complete(active.token, 99), RangeError);
  assert.deepEqual(controller.getState(), active);
  assert.equal(controller.complete(active.token, 100), true);
  controller.reset();
  assert.throws(() => controller.update(current, 0), RangeError);
});
