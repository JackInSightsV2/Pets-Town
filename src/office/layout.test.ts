import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent, OfficeProject } from '../shared/contract';
import { buildAgentGroups, createOfficeLayout, type OfficeGeometry, type Point } from './layout';

const agent = (agentId: string, projectId = 'p0', parentAgentId: string | null = null): OfficeAgent => ({
  agentId, projectId, parentAgentId, displayName: agentId, role: null, task: null, runtimeState: 'working',
  activityKind: 'unknown', lastObservedAt: null, pendingRequestIds: [], petAssetId: null, recentActivity: [],
});
const project = (projectId: string): OfficeProject => ({ projectId, displayName: projectId, cwd: null });
const identities = (groups: ReturnType<typeof buildAgentGroups>) => groups.map(group => ({ key: group.key,
  parent: group.parent?.agentId ?? null, children: group.children.map(agent => agent.agentId), unparented: group.unparented }));

test('groups preserve every identity through nested, missing, cross-project and cyclic parents', () => {
  const agents = [agent('main'), agent('child', 'p0', 'main'), agent('grandchild', 'p0', 'child'),
    agent('orphan', 'p0', 'missing'), agent('orphan-child', 'p0', 'orphan'), agent('cross', 'p1', 'main'),
    agent('cycle-a', 'p0', 'cycle-b'), agent('cycle-b', 'p0', 'cycle-a'), agent('cycle-child', 'p0', 'cycle-b')];
  const before = structuredClone(agents);
  const groups = buildAgentGroups([...agents, agents[0]]);
  const members = groups.flatMap(group => [...(group.parent ? [group.parent] : []), ...group.children]);
  assert.deepEqual(members.map(agent => agent.agentId).sort(), agents.map(agent => agent.agentId).sort());
  assert.deepEqual(groups.find(group => group.parent?.agentId === 'main')?.children.map(agent => agent.agentId), ['child', 'grandchild']);
  assert.deepEqual(groups.find(group => group.parent?.agentId === 'cycle-a')?.children.map(agent => agent.agentId), ['cycle-b', 'cycle-child']);
  assert.deepEqual(groups.filter(group => group.unparented).map(group => group.children.map(agent => agent.agentId)), [['orphan', 'orphan-child'], ['cross']]);
  assert.deepEqual(identities(buildAgentGroups([...agents].reverse())), identities(groups));
  assert.deepEqual(agents, before);
});

test('six projects and ten children have separate homes that survive joins, leaves, hiding and reorder', () => {
  const projects = Array.from({ length: 6 }, (_, index) => project(`p${index}`));
  const agents = projects.map(project => agent(`main-${project.projectId}`, project.projectId));
  agents.push(...Array.from({ length: 10 }, (_, index) => agent(`child-${index}`, 'p0', 'main-p0')));
  const mapper = createOfficeLayout();
  const first = mapper.map({ projects, agents });
  assert.equal(first.homes.size, 16);
  assert.equal(new Set(first.areas.map(area => area.projectId)).size, 6);
  assert.ok(first.width > 1000);
  const points = [...first.homes.values()];
  for (let i = 0; i < points.length; i++) for (const other of points.slice(i + 1)) {
    assert.ok(Math.abs(points[i].x - other.x) >= 96 || Math.abs(points[i].y - other.y) >= 96, '96px pet footprints must not overlap');
  }
  const sameHomes = (homes: ReadonlyMap<string, Point>) => { for (const [id, home] of first.homes) assert.deepEqual(homes.get(id), home, id); };
  sameHomes(mapper.map({ projects: [...projects].reverse(), agents: [...agents].reverse() }).homes);
  mapper.map({ projects: projects.filter(project => project.projectId !== 'p4'), agents: agents.filter(agent => !agent.parentAgentId && agent.projectId !== 'p4') });
  const joined = mapper.map({ projects: [project('earlier-project'), ...projects],
    agents: [agent('earlier-agent', 'earlier-project'), agent('added-child', 'p0', 'main-p0'), ...agents] });
  sameHomes(joined.homes);
  assert.notDeepEqual(joined.homes.get('added-child'), first.homes.get('child-0'));
  const crowded = mapper.map({ projects, agents: [...agents, ...Array.from({ length: 40 }, (_, index) => agent(`extra-${index}`, 'p0', 'main-p0'))] });
  sameHomes(crowded.homes);
  assert.ok(crowded.height > first.height);
});

test('artwork geometry controls centers and landmarks independently of allocation and rejects overlapping areas', () => {
  const config: Partial<OfficeGeometry> = {
    canvas: { width: 400, height: 360 }, areas: [{ x: 20, y: 20, width: 240, height: 160 }],
    spacing: { x: 80, y: 80 }, padding: 40, gap: 20,
    entrance: { x: 300, y: 320 }, standup: { x: 300, y: 240 },
    waterCooler: [{ x: 280, y: 240 }, { x: 360, y: 240 }], rest: { x: 300, y: 320 },
  };
  const mapper = createOfficeLayout(config);
  config.areas![0].x = 999;
  const layout = mapper.map({ projects: [project('p0')], agents: [agent('a'), agent('b')] });
  assert.deepEqual(layout.homes.get('a'), { x: 60, y: 60 });
  assert.deepEqual(layout.homes.get('b'), { x: 140, y: 60 });
  assert.deepEqual(layout.waterCooler, [{ x: 280, y: 240 }, { x: 360, y: 240 }]);
  assert.deepEqual(layout.entrance, { x: 300, y: 320 });
  assert.throws(() => createOfficeLayout({ areas: [{ x: 0, y: 0, width: 200, height: 200 }, { x: 10, y: 10, width: 200, height: 200 }] }), RangeError);
});
