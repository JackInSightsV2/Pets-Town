import { venueLayout, insideVenue, audienceSeats } from "./layout";
/** Approximate venue geometry in uncalibrated source scan units. */
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
export const desks = [...venueLayout.tables, ...venueLayout.extraTables];
export const obstacles: Obstacle[] = [
  ...desks.map((p) => ({
    x: p.x,
    z: p.z,
    width: p.rotation ? p.length + 0.1 : p.width + 0.95,
    depth: p.rotation ? p.width + 0.95 : p.length + 0.1,
  })),
  { x: 3.75, z: -4, width: 2.7, depth: 2.7 },
  { x: -6.5, z: -0.85, width: 2.5, depth: 1 },
  { x: 0.8, z: -8.65, width: 1.9, depth: 0.85 },
  { x: 6.5, z: 1.55, width: 2.8, depth: 0.85 },
  { x: 6.9, z: 2.9, width: 1.25, depth: 1.25 },
  { x: 5.65, z: 2.25, width: 0.6, depth: 0.6 },
  ...[venueLayout.helpDesk, venueLayout.stageDesk].map((p) => ({
    x: p.x, z: p.z, width: p.depth + 0.15, depth: p.width + 0.15,
  })),
  ...[venueLayout.backdrop, venueLayout.helpSign].map((p) => ({
    x: p.x, z: p.z,
    width: Math.abs(Math.cos(p.rotation)) * (p.width + 0.3) + Math.abs(Math.sin(p.rotation)) * 0.5,
    depth: Math.abs(Math.sin(p.rotation)) * (p.width + 0.3) + Math.abs(Math.cos(p.rotation)) * 0.5,
  })),
  ...[-6.15, -2.05].map((z) => ({ x: 4.25, z, width: 0.5, depth: 0.7 })),
  ...audienceSeats.map((p) => ({ ...p, width: 0.52, depth: 0.52 })),
];
export function walkable(p: FloorPoint, margin = 0.16): boolean {
  if (
    !insideVenue(p) ||
    ![
      [margin, 0],
      [-margin, 0],
      [0, margin],
      [0, -margin],
    ].every(([x, z]) => insideVenue({ x: p.x + x, z: p.z + z }))
  )
    return false;
  return !obstacles.some(
    (o) =>
      Math.abs(p.x - o.x) < o.width / 2 + margin &&
      Math.abs(p.z - o.z) < o.depth / 2 + margin,
  );
}
const step = 0.25;
const cells: FloorPoint[] = [];
for (let x = -10; x <= 8; x += step)
  for (let z = -9; z <= 8; z += step)
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
    { x: -4, z: -6 },
    { x: -4.6, z: -2.5 },
    { x: -6.5, z: -3.7 },
    { x: -1.8, z: 2.6 },
    { x: 0.3, z: 4.9 },
    { x: 4.6, z: 4.9 },
    { x: 1.8, z: 0 },
    { x: -6.35, z: -7.6 },
    { x: -6.35, z: -5.75 },
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
