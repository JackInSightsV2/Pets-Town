import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent } from '../shared/contract';
import type { SpriteLifecycle } from '../office/lifecycle/controller';
import { DESK_SEATS, REST_SEATS } from '../office/seating';
import { officeGeometry } from '../office/environment';
import { createSceneLayout } from './scene-layout';

const agent = (agentId: string): OfficeAgent => ({ agentId, projectId: 'p', parentAgentId: null, displayName: agentId,
  role: null, task: null, runtimeState: 'unknown', activityKind: 'unknown', lastObservedAt: null,
  pendingRequestIds: [], petAssetId: null, recentActivity: [] });
const life = (agentId: string, visible: boolean, phase: SpriteLifecycle['phase']): SpriteLifecycle => ({
  agentId, turnId: 't', status: visible ? 'started' : 'succeeded', phase, pose: 'awake', visible,
  attention: false, meetingEligible: visible, token: null,
});

test('historical completed identities do not displace active pets, and assigned chairs survive exit and return', () => {
  const history = Array.from({ length: 68 }, (_, i) => agent(`history-${i}`));
  const active = Array.from({ length: 7 }, (_, i) => agent(`live-${i}`));
  const snapshot = { agents: [...history, ...active], projects: [], pendingRequests: [] };
  const lives = [...history.map(a => life(a.agentId, false, 'absent')), ...active.map(a => life(a.agentId, true, 'present'))];
  const mapper = createSceneLayout(officeGeometry);
  const ids = new Set(snapshot.agents.map(a => a.agentId));
  const first = mapper.map(snapshot, lives, ids);
  assert.equal(first.homes.size, 7);
  assert.deepEqual([...first.homes.values()], DESK_SEATS.slice(0, 7));
  const away = mapper.map(snapshot, lives.map(l => l.agentId === 'live-0' ? life(l.agentId, false, 'absent') : l), ids);
  assert.deepEqual(away.homes.get('live-0'), first.homes.get('live-0'));
  const returning = mapper.map(snapshot, lives, ids);
  assert.deepEqual([...returning.homes], [...first.homes]);
  const joined = mapper.map({ ...snapshot, agents: [...snapshot.agents, agent('new')] }, [...lives, life('new', true, 'entering')], new Set([...ids, 'new']));
  for (const [id, home] of first.homes) assert.deepEqual(joined.homes.get(id), home);
});

test('closed and departed occupants release chairs without moving the remaining occupants', () => {
  const mapper = createSceneLayout(officeGeometry);
  const a = agent('a'), b = agent('b'), c = agent('c');
  const snapshot = { agents: [a, b], projects: [], pendingRequests: [] };
  const first = mapper.map(snapshot, [], new Set(['a', 'b']));
  const closed = mapper.map({ ...snapshot, agents: [{ ...a, runtimeState: 'closed' }, b, c] }, [], new Set(['a', 'b', 'c']));
  assert.equal(closed.homes.has('a'), false);
  assert.deepEqual(closed.homes.get('b'), first.homes.get('b'));
  assert.deepEqual(closed.homes.get('c'), first.homes.get('a'));
  const departed = mapper.map({ ...snapshot, agents: [c, agent('d')] }, [], new Set(['c', 'd']));
  assert.equal(departed.homes.has('b'), false);
  assert.deepEqual(departed.homes.get('c'), closed.homes.get('c'));
  assert.deepEqual(departed.homes.get('d'), first.homes.get('b'));
  const historicalReturn = mapper.map(snapshot, [life('a', false, 'absent'), life('b', false, 'absent')], new Set(['a', 'b']));
  assert.equal(historicalReturn.homes.size, 0);
});

test('rest chairs and overflow retain artwork geometry without expanding into unused generic desk areas', () => {
  const mapper = createSceneLayout(officeGeometry);
  const empty = mapper.map({ agents: [], projects: [], pendingRequests: [] }, [], new Set());
  assert.equal(empty.width, officeGeometry.canvas!.width);
  assert.equal(empty.height, officeGeometry.canvas!.height);
  assert.deepEqual(empty.entrance, officeGeometry.entrance);
  assert.deepEqual(empty.standup, officeGeometry.standup);
  assert.deepEqual(empty.waterCooler, officeGeometry.waterCooler);
  const agents = Array.from({ length: 24 }, (_, index) => ({ ...agent(`idle-${index}`), runtimeState: 'idle' as const }));
  const ids = new Set(agents.map(value => value.agentId));
  const first = mapper.map({ agents, projects: [], pendingRequests: [] }, [], ids);
  assert.deepEqual([...first.rests.values()].slice(0, REST_SEATS.length), REST_SEATS);
  assert.equal(new Set([...first.homes.values()].map(point => `${point.x},${point.y}`)).size, agents.length);
  assert.equal(new Set([...first.rests.values()].map(point => `${point.x},${point.y}`)).size, agents.length);
  assert.ok(first.homes.get('idle-14')!.x > officeGeometry.canvas!.width);
  assert.ok(first.rests.get('idle-10')!.x > officeGeometry.canvas!.width);
  for (const point of [...first.homes.values(), ...first.rests.values()]) {
    assert.ok(point.x + 60 <= first.width);
    assert.ok(point.y + 60 <= first.height);
  }
  const next = mapper.map({ agents: agents.map((value, index) => index === 0 ? { ...value, runtimeState: 'working' as const } : value), projects: [], pendingRequests: [] }, [], ids);
  assert.equal(next.rests.has('idle-0'), false);
  assert.deepEqual(next.rests.get('idle-1'), first.rests.get('idle-1'));
  assert.deepEqual([...next.homes], [...first.homes]);
});

test('a live closing sprite retains its chair until the death animation settles', () => {
  const mapper = createSceneLayout(officeGeometry);
  const a = agent('a'), b = agent('b');
  const snapshot = { agents: [a, b], projects: [], pendingRequests: [] };
  const ids = new Set(['a', 'b']);
  const first = mapper.map(snapshot, [], ids);
  const closed = { ...snapshot, agents: [{ ...a, runtimeState: 'closed' as const }, b] };
  const dying = mapper.map(closed, [life('a', true, 'dying')], ids);
  assert.deepEqual(dying.homes.get('a'), first.homes.get('a'));
  const settled = mapper.map(closed, [life('a', false, 'absent')], ids);
  assert.equal(settled.homes.has('a'), false);
  assert.deepEqual(settled.homes.get('b'), first.homes.get('b'));
});
