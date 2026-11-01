import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAvoiding, clearMovement, createTargetReservations, nearestFreeFloor, PET_SPACING } from './spacing';
import { floorCells, floorPath, walkable, type FloorPoint } from './navigation';

const separation = (points: readonly FloorPoint[]) => {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++)
    assert.ok(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z) >= PET_SPACING - 1e-7, `${i}/${j} overlap`);
};
test('fifteen real and celebration pets get distinct walkable entrance and destination slots', () => {
  const positions: FloorPoint[] = [];
  for (let i = 0; i < 15; i++) {
    const point = nearestFreeFloor({ x: -8.7, z: 0.4 }, positions);
    assert.ok(point); assert.ok(walkable(point)); positions.push(point);
  }
  separation(positions);
  const allocator = createTargetReservations();
  const requests = positions.map((point, i) => ({ id: `${i}`, desired: { x: 0, z: 0 } }));
  const first = allocator.map(requests);
  separation([...first.values()]);
  assert.deepEqual(allocator.map([...requests].reverse()), first);
  const survivor = first.get('1');
  const released = allocator.map(requests.filter(row => row.id !== '0'));
  assert.deepEqual(released.get('1'), survivor);
  const added = allocator.map([...requests.filter(row => row.id !== '0'), { id: 'new', desired: { x: 0, z: 0 } }]);
  assert.deepEqual(added.get('new'), first.get('0'));
  separation([...added.values()]);
});
test('fixed sleeping pets retain their exact placement while new destinations stay clear', () => {
  const allocator = createTargetReservations();
  const point = nearestFreeFloor({ x: 0, z: 0 }, [])!;
  const targets = allocator.map([{ id: 'sleeping', desired: point, fixed: true }, { id: 'new', desired: point }]);
  assert.deepEqual(targets.get('sleeping'), point);
  separation([...targets.values()]);
});
test('crossing walkers stay separated and make progress with occupancy-aware rerouting', () => {
  const start = floorCells.find(point => clearMovement(point, { x: point.x + 3, z: point.z }, []) && walkable({ x: point.x + 3, z: point.z }))!;
  assert.ok(start);
  const ends = [{ x: start.x + 3, z: start.z }, { ...start }];
  const positions = [{ ...start }, { ...ends[0] }];
  const origins = structuredClone(positions);
  const paths = positions.map((point, i) => floorPath(point, ends[i]));
  for (let tick = 0; tick < 500; tick++) {
    for (let i = 0; i < 2; i++) {
      const peers = positions.filter((_, j) => i !== j);
      if (tick % 15 === 0) paths[i] = floorPath(positions[i], ends[i], peers);
      if (!paths[i].length) continue;
      const next = advanceAvoiding(positions[i], paths[i][0], 1 / 30, peers);
      positions[i] = { x: next.x, z: next.z };
      if (next.arrived) paths[i].shift();
    }
    separation(positions);
    assert.ok(positions.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
  }
  for (let i = 0; i < 2; i++) assert.ok(Math.hypot(positions[i].x - origins[i].x, positions[i].z - origins[i].z) > 1, `walker ${i} did not progress`);
});
