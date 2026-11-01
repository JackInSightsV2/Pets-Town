import { test } from "node:test";
import assert from "node:assert/strict";
import {
  floorPath,
  walkable,
  createVenuePlacement,
  nearestFloor,
} from "./navigation";
test("routes from the entrance to desks and cooler stay on clear floor", () => {
  for (const destination of [
    { x: -7.5, z: -3.5 },
    { x: 4, z: 0.5 },
    { x: 5, z: 0.5 },
    { x: 4, z: 2 },
  ]) {
    const path = floorPath({ x: -7, z: 6 }, destination);
    assert.ok(path.length > 1);
    assert.deepEqual(path.at(-1), nearestFloor(destination));
    assert.ok(path.every((p) => walkable(p)));
    for (let i = 1; i < path.length; i++)
      assert.ok(
        Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) <=
          0.501,
      );
  }
});
test("pets keep distinct homes as visibility, ordering and project count change", () => {
  const placement = createVenuePlacement();
  const agents = Array.from({ length: 60 }, (_, i) => ({
    agentId: `a-${i}`,
    projectId: `p-${i % 9}`,
  }));
  const initial = new Map(placement.map(agents));
  placement.map([...agents].reverse());
  assert.deepEqual(placement.homes, initial);
  assert.equal(
    new Set([...initial.values()].map((p) => `${p.x},${p.z}`)).size,
    60,
  );
  assert.ok([...initial.values()].every((p) => walkable(p)));
  placement.map([{ agentId: "new", projectId: "new" }]);
  for (const [id, p] of initial) assert.deepEqual(placement.homes.get(id), p);
});
