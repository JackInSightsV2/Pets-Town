import test from 'node:test';
import assert from 'node:assert/strict';
import { planFamilyProximity, type FamilyAgent, type FamilyProximityInput } from './family-proximity';
import type { Point } from './layout';

const agent = (agentId: string, parentAgentId: string | null = null,
  runtimeState: FamilyAgent['runtimeState'] = 'working'): FamilyAgent => ({ agentId, parentAgentId, runtimeState });
const points = (...entries: [string, number, number][]): Map<string, Point> =>
  new Map(entries.map(([id, x, y]) => [id, { x, y }]));
const input = (agents: readonly FamilyAgent[], positions: ReadonlyMap<string, Point>,
  options: Partial<FamilyProximityInput> = {}): FamilyProximityInput => ({
  agents, positions, bounds: { x: 0, y: 0, width: 1600, height: 1000 },
  spacing: { x: 100, y: 100 }, maxRings: 1, ...options,
});
function assertSeparated(positions: ReadonlyMap<string, Point>, spacing: Point) {
  const entries = [...positions];
  for (let i = 0; i < entries.length; i++) for (const [otherId, other] of entries.slice(i + 1)) {
    const [id, point] = entries[i];
    assert.ok(Math.abs(point.x - other.x) >= spacing.x || Math.abs(point.y - other.y) >= spacing.y,
      `${id} and ${otherId} must retain separate footprints`);
  }
}
function assertWithinBounds(positions: ReadonlyMap<string, Point>, source: FamilyProximityInput) {
  const { bounds, spacing } = source;
  for (const point of positions.values()) {
    assert.ok(point.x - spacing.x / 2 >= bounds.x && point.x + spacing.x / 2 <= bounds.x + bounds.width);
    assert.ok(point.y - spacing.y / 2 >= bounds.y && point.y + spacing.y / 2 <= bounds.y + bounds.height);
  }
}
function assertNear(positions: ReadonlyMap<string, Point>, childId: string, parentId: string,
  source: FamilyProximityInput) {
  const child = positions.get(childId)!, parent = positions.get(parentId)!;
  assert.ok(Math.abs(child.x - parent.x) <= source.spacing.x * source.maxRings);
  assert.ok(Math.abs(child.y - parent.y) <= source.spacing.y * source.maxRings);
}

test('nested families and concurrent unrelated work retain distinct bounded destinations', () => {
  const source = input([
    agent('root-a'), agent('a-child', 'root-a'), agent('a-grandchild', 'a-child'), agent('a-sibling', 'root-a'),
    agent('root-b'), agent('b-child', 'root-b'), agent('unrelated', null, 'idle'),
  ], points(['root-a', 300, 300], ['a-child', 1100, 100], ['a-grandchild', 1300, 100], ['a-sibling', 1100, 300],
    ['root-b', 700, 300], ['b-child', 1300, 500], ['unrelated', 300, 700]));
  const result = planFamilyProximity(source);
  for (const [child, parent] of [['a-child', 'root-a'], ['a-grandchild', 'a-child'], ['a-sibling', 'root-a'], ['b-child', 'root-b']]) {
    assert.equal(result.outcomes.get(child), 'nearby');
    assertNear(result.positions, child, parent, source);
  }
  for (const id of ['root-a', 'root-b', 'unrelated']) assert.deepEqual(result.positions.get(id), source.positions.get(id));
  assert.deepEqual([...result.positions.keys()].sort(), [...source.positions.keys()].sort());
  assertSeparated(result.positions, source.spacing);
  assertWithinBounds(result.positions, source);
});

test('direct observed parentage crosses projects without grouping names or project peers', () => {
  const agents = [
    { ...agent('parent'), projectId: 'synthetic-project-a', displayName: 'Synthetic same name' },
    { ...agent('child', 'parent'), projectId: 'synthetic-project-b', displayName: 'Synthetic same name' },
    { ...agent('peer'), projectId: 'synthetic-project-b', displayName: 'Synthetic same name' },
  ];
  const source = input(agents, points(['parent', 300, 300], ['child', 1100, 700], ['peer', 1300, 700]));
  const result = planFamilyProximity(source);
  assertNear(result.positions, 'child', 'parent', source);
  assert.notDeepEqual(result.positions.get('child'), source.positions.get('child'));
  assert.deepEqual(result.positions.get('peer'), source.positions.get('peer'));
  assert.deepEqual([...result.outcomes.keys()], ['child']);
});

test('source and reservation order cannot change the plan, and inputs remain untouched', () => {
  const source = input([agent('parent'), agent('child-a', 'parent'), agent('child-b', 'parent')],
    points(['parent', 300, 300], ['child-a', 1100, 500], ['child-b', 1300, 500]), {
      reservedHomes: points(['hidden-a', 300, 200], ['hidden-b', 200, 300]),
      reservedPoints: [{ x: 400, y: 300 }, { x: 300, y: 400 }], fixedAgentIds: new Set(['parent']),
    });
  const original = structuredClone(source);
  const first = planFamilyProximity(source);
  const second = planFamilyProximity({ ...source, agents: [...source.agents].reverse(),
    positions: new Map([...source.positions].reverse()), reservedHomes: new Map([...source.reservedHomes!].reverse()),
    reservedPoints: [...source.reservedPoints!].reverse(), fixedAgentIds: new Set([...source.fixedAgentIds!].reverse()) });
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.deepEqual([...first.outcomes], [...second.outcomes]);
  assert.deepEqual(source, original);
  for (const [id, point] of first.positions) assert.notEqual(point, source.positions.get(id));
  assertSeparated(first.positions, source.spacing);
});

test('hidden or absent immediate parents are not fabricated or replaced by visible ancestors', () => {
  const source = input([
    agent('grandparent'), agent('hidden-parent', 'grandparent'),
    agent('child-hidden', 'hidden-parent'), agent('child-absent', 'absent-parent'),
  ], points(['grandparent', 300, 300], ['child-hidden', 1100, 500], ['child-absent', 1300, 500]));
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions, source.positions);
  assert.equal(result.outcomes.size, 0);
  assert.equal(result.positions.has('hidden-parent'), false);
  assert.equal(result.positions.has('absent-parent'), false);
});

test('a supplied position without an observed parent identity cannot establish parentage', () => {
  const source = input([agent('child', 'unobserved')], points(['unobserved', 300, 300], ['child', 1100, 500]));
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions, source.positions);
  assert.equal(result.outcomes.size, 0);
});

test('only working children move; waiting, idle, unknown, error and closed remain caller-owned', () => {
  const states: FamilyAgent['runtimeState'][] = ['idle', 'waiting-for-input', 'waiting-for-approval', 'unknown', 'error', 'closed'];
  const agents = [agent('parent'), ...states.map(state => agent(`child-${state}`, 'parent', state))];
  const destinations = points(['parent', 300, 300], ...states.map((state, index): [string, number, number] =>
    [`child-${state}`, 1100, 100 + index * 100]));
  const result = planFamilyProximity(input(agents, destinations));
  assert.deepEqual(result.positions, destinations);
  assert.equal(result.outcomes.size, 0);
});

test('working children use the visible nonworking parent destination supplied by lifecycle', () => {
  const source = input([agent('resting-parent', null, 'idle'), agent('child', 'resting-parent')],
    points(['resting-parent', 300, 700], ['child', 1100, 100]), {
      reservedHomes: points(['resting-parent', 300, 300], ['child', 1100, 100]),
    });
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions.get('resting-parent'), { x: 300, y: 700 });
  assertNear(result.positions, 'child', 'resting-parent', source);
  assert.ok(result.positions.get('child')!.y >= 600, 'child follows the supplied rest anchor, not the allocated desk');
});

test('self cycles, longer cycles and descendants entering cycles keep their own destinations', () => {
  const source = input([agent('self', 'self'), agent('cycle-a', 'cycle-b'), agent('cycle-b', 'cycle-a'), agent('descendant', 'cycle-a')],
    points(['self', 100, 100], ['cycle-a', 300, 300], ['cycle-b', 1100, 500], ['descendant', 1300, 700]));
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions, source.positions);
  for (const id of source.positions.keys()) assert.equal(result.outcomes.get(id), 'cyclic-parent');
});

test('ambiguous duplicate identities cannot create order-dependent parent links', () => {
  const agents = [agent('root'), agent('duplicate', 'root'), agent('duplicate', null), agent('child', 'duplicate')];
  const source = input(agents, points(['root', 300, 300], ['duplicate', 1100, 500], ['child', 1300, 700]));
  const first = planFamilyProximity(source);
  const reversed = planFamilyProximity({ ...source, agents: [...agents].reverse() });
  assert.deepEqual(first.positions, source.positions);
  assert.deepEqual(first, reversed);
  assert.equal(first.outcomes.size, 0);
});

test('a full finite neighborhood falls back without searching the next ring', () => {
  const surrounding = [
    { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 400, y: 200 },
    { x: 200, y: 300 }, { x: 400, y: 300 },
    { x: 200, y: 400 }, { x: 300, y: 400 }, { x: 400, y: 400 },
  ];
  const source = input([agent('parent'), agent('child', 'parent')], points(['parent', 300, 300], ['child', 1100, 700]),
    { reservedPoints: surrounding });
  const limited = planFamilyProximity(source);
  assert.equal(limited.outcomes.get('child'), 'no-room');
  assert.deepEqual(limited.positions, source.positions);
  const wider = planFamilyProximity({ ...source, maxRings: 2 });
  assert.equal(wider.outcomes.get('child'), 'nearby');
  assert.notDeepEqual(wider.positions.get('child'), source.positions.get('child'));
  assertNear(wider.positions, 'child', 'parent', { ...source, maxRings: 2 });
});

test('hidden allocated homes and water-cooler endpoints remain reserved', () => {
  const source = input([agent('parent'), agent('child', 'parent')], points(['parent', 300, 300], ['child', 1100, 700]), {
    reservedHomes: points(['parent', 300, 300], ['child', 1100, 700], ['hidden-child', 300, 200]),
    reservedPoints: [{ x: 200, y: 300 }, { x: 400, y: 300 }],
  });
  const result = planFamilyProximity(source);
  assert.equal(result.outcomes.get('child'), 'nearby');
  assertNear(result.positions, 'child', 'parent', source);
  const child = result.positions.get('child')!;
  for (const other of [...source.reservedPoints!, source.reservedHomes!.get('hidden-child')!]) {
    assert.ok(Math.abs(child.x - other.x) >= source.spacing.x || Math.abs(child.y - other.y) >= source.spacing.y);
  }
  assert.equal(result.positions.has('hidden-child'), false);
  assertSeparated(result.positions, source.spacing);
});

test('captured fixed meeting return destinations survive other family movement', () => {
  const capturedReturn = { x: 800, y: 300 };
  const source = input([agent('parent'), agent('meeting-child', 'parent'), agent('other-child', 'parent')],
    new Map([...points(['parent', 300, 300], ['other-child', 1100, 700]), ['meeting-child', capturedReturn]]), {
      fixedAgentIds: new Set(['parent', 'meeting-child']),
      reservedHomes: points(['parent', 300, 300], ['meeting-child', 800, 300], ['other-child', 1100, 700]),
      reservedPoints: [{ x: 300, y: 200 }, { x: 200, y: 300 }],
    });
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions.get('meeting-child'), capturedReturn);
  assert.equal(result.outcomes.get('meeting-child'), 'fixed');
  assert.deepEqual(result.positions.get('parent'), source.positions.get('parent'));
  assertNear(result.positions, 'other-child', 'parent', source);
  assertSeparated(result.positions, source.spacing);
  assert.deepEqual(planFamilyProximity({ ...source, positions: result.positions }), result);
});

test('an already safe off-grid nearby position stays unchanged', () => {
  const source = input([agent('parent'), agent('child', 'parent')], points(['parent', 300, 300], ['child', 450, 300]),
    { maxRings: 2, reservedHomes: points(['child', 450, 300]) });
  const result = planFamilyProximity(source);
  assert.deepEqual(result.positions, source.positions);
  assert.equal(result.outcomes.get('child'), 'nearby');
});

test('edge parents only receive child destinations whose full footprint fits the bounds', () => {
  const source = input([agent('parent'), agent('child', 'parent')], points(['parent', 50, 50], ['child', 1100, 700]));
  const result = planFamilyProximity(source);
  assert.equal(result.outcomes.get('child'), 'nearby');
  assertNear(result.positions, 'child', 'parent', source);
  assertWithinBounds(result.positions, source);
  assertSeparated(result.positions, source.spacing);
});

test('invalid search budgets, geometry and nonfinite destinations fail explicitly', () => {
  const source = input([agent('parent')], points(['parent', 300, 300]));
  for (const maxRings of [0, 5, 1.5, Infinity, NaN]) {
    assert.throws(() => planFamilyProximity({ ...source, maxRings }), RangeError);
  }
  for (const spacing of [{ x: 0, y: 100 }, { x: 100, y: -1 }, { x: Infinity, y: 100 }]) {
    assert.throws(() => planFamilyProximity({ ...source, spacing }), RangeError);
  }
  for (const bounds of [{ x: 0, y: 0, width: 0, height: 1000 }, { x: NaN, y: 0, width: 1000, height: 1000 }]) {
    assert.throws(() => planFamilyProximity({ ...source, bounds }), RangeError);
  }
  assert.throws(() => planFamilyProximity({ ...source, positions: points(['parent', NaN, 300]) }), RangeError);
  assert.throws(() => planFamilyProximity({ ...source, reservedHomes: points(['hidden', Infinity, 300]) }), RangeError);
  assert.throws(() => planFamilyProximity({ ...source, reservedPoints: [{ x: 300, y: NaN }] }), RangeError);
});
