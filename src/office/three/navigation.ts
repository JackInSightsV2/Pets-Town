/** Approximate venue geometry, rebuilt from a private scan reference. Units are metres. */
export interface FloorPoint {
  x: number;
  z: number;
}
export interface Obstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
}
export const desks = [
  { x: -6, z: -3.7 },
  { x: -3.3, z: -3.7 },
  { x: -6, z: 0 },
  { x: -3.3, z: 0 },
  { x: -4.5, z: 4 },
];
export const obstacles: Obstacle[] = [
  ...desks.map((p) => ({ ...p, width: 2.5, depth: 2.5 })),
  { x: -8, z: -5.9, width: 0.7, depth: 0.7 },
  { x: -8, z: 5.7, width: 0.8, depth: 0.8 },
  { x: 2, z: -2.4, width: 0.7, depth: 0.7 },
  { x: 8.1, z: 6, width: 0.8, depth: 0.8 },
  { x: 3.7, z: -0.8, width: 0.6, depth: 0.6 },
  { x: 0.6, z: -5, width: 3.5, depth: 2.4 },
  { x: 7.4, z: -0.9, width: 2.2, depth: 1.1 },
  { x: 6.4, z: 4.8, width: 3.5, depth: 1.4 },
  { x: 6.3, z: 3, width: 1.4, depth: 0.8 },
  { x: 4.7, z: -0.9, width: 0.8, depth: 0.8 },
];
export function walkable(p: FloorPoint, margin = 0.32): boolean {
  if (
    p.x < -8.6 ||
    p.x > 8.6 ||
    p.z < -6.6 ||
    p.z > 6.6 ||
    (p.x > 2.6 && p.z < -1.65)
  )
    return false;
  return !obstacles.some(
    (o) =>
      Math.abs(p.x - o.x) < o.width / 2 + margin &&
      Math.abs(p.z - o.z) < o.depth / 2 + margin,
  );
}
const step = 0.5;
const cells: FloorPoint[] = [];
for (let x = -8; x <= 8; x += step)
  for (let z = -6; z <= 6; z += step)
    if (walkable({ x, z })) cells.push({ x, z });
const key = (p: FloorPoint) => `${p.x},${p.z}`;
const grid = new Map(cells.map((p) => [key(p), p]));
export function nearestFloor(
  p: FloorPoint,
  excluded: ReadonlySet<string> = new Set(),
): FloorPoint {
  return cells
    .filter((c) => !excluded.has(key(c)))
    .reduce(
      (best, c) =>
        Math.hypot(c.x - p.x, c.z - p.z) <
        Math.hypot(best.x - p.x, best.z - p.z)
          ? c
          : best,
      cells.find((c) => !excluded.has(key(c))) ?? cells[0],
    );
}
export function floorPath(from: FloorPoint, to: FloorPoint): FloorPoint[] {
  const start = nearestFloor(from),
    end = nearestFloor(to),
    queue = [start],
    previous = new Map<string, string | null>([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(end)) break;
    for (const [dx, dz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const q = { x: p.x + dx, z: p.z + dz },
        k = key(q);
      if (grid.has(k) && !previous.has(k)) {
        previous.set(k, key(p));
        queue.push(q);
      }
    }
  }
  if (!previous.has(key(end))) return [start];
  const path: FloorPoint[] = [];
  let cursor: string | null = key(end);
  while (cursor) {
    path.unshift(grid.get(cursor)!);
    cursor = previous.get(cursor) ?? null;
  }
  return path;
}
/** Append identities once: hiding pets and changing arrival order cannot move existing homes. */
export function createVenuePlacement() {
  const homes = new Map<string, FloorPoint>();
  const occupied = new Set<string>();
  const projects = new Map<string, number>();
  const zones = [
    { x: -7.4, z: -3.5 },
    { x: -4.7, z: -3.5 },
    { x: -7.4, z: 0.2 },
    { x: -4.7, z: 0.2 },
    { x: -5.8, z: 4 },
    { x: 1, z: 2 },
    { x: 4, z: 2 },
  ];
  return {
    homes,
    map(agents: readonly { agentId: string; projectId: string }[]) {
      for (const a of [...agents].sort((a, b) =>
        a.agentId.localeCompare(b.agentId),
      )) {
        if (homes.has(a.agentId)) continue;
        if (!projects.has(a.projectId))
          projects.set(a.projectId, projects.size);
        const point = nearestFloor(
          zones[projects.get(a.projectId)! % zones.length],
          occupied,
        );
        homes.set(a.agentId, point);
        for (const cell of cells)
          if (Math.hypot(cell.x - point.x, cell.z - point.z) < 0.9)
            occupied.add(key(cell));
      }
      return homes;
    },
  };
}
