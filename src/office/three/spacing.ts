import { floorCells, walkable, type FloorPoint } from './navigation';
import { advancePoint } from './movement';

export const PET_SPACING = 0.95;
const distance = (a: FloorPoint, b: FloorPoint) => Math.hypot(a.x - b.x, a.z - b.z);
export function nearestFreeFloor(desired: FloorPoint, occupied: readonly FloorPoint[]): FloorPoint | null {
  let best: FloorPoint | null = null, score = Infinity;
  for (const cell of floorCells) {
    const candidate = distance(cell, desired);
    if (candidate < score && occupied.every(point => distance(cell, point) >= PET_SPACING - 1e-8)) {
      best = cell; score = candidate;
    }
  }
  return best && { ...best };
}
export interface TargetRequest { id: string; desired: FloorPoint; fixed?: boolean }
/** Keep unchanged reservations first, then allocate changed/new destinations. */
export function createTargetReservations() {
  const saved = new Map<string, { desired: FloorPoint; point: FloorPoint }>();
  return {
    map(requests: readonly TargetRequest[]) {
      const ids = new Set(requests.map(request => request.id));
      for (const id of saved.keys()) if (!ids.has(id)) saved.delete(id);
      const result = new Map<string, FloorPoint>();
      const available = (point: FloorPoint) => [...result.values()].every(other => distance(point, other) >= PET_SPACING - 1e-8);
      const ordered = [...requests].sort((a, b) => a.id.localeCompare(b.id));
      for (const request of ordered.filter(row => row.fixed)) {
        result.set(request.id, { ...request.desired });
        saved.set(request.id, { desired: { ...request.desired }, point: { ...request.desired } });
      }
      for (const request of ordered.filter(row => !row.fixed)) {
        const previous = saved.get(request.id);
        if (previous && distance(previous.desired, request.desired) < 0.01 && available(previous.point)) result.set(request.id, previous.point);
      }
      for (const request of ordered) if (!result.has(request.id)) {
        const point = nearestFreeFloor(request.desired, [...result.values()]);
        if (!point) { saved.delete(request.id); continue; }
        result.set(request.id, point);
        saved.set(request.id, { desired: { ...request.desired }, point });
      }
      return result;
    },
  };
}
function segmentDistance(point: FloorPoint, from: FloorPoint, to: FloorPoint) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / length)) : 0;
  return distance(point, { x: from.x + dx * t, z: from.z + dz * t });
}
export function clearMovement(from: FloorPoint, to: FloorPoint, occupied: readonly FloorPoint[]) {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return false;
  const steps = Math.max(1, Math.ceil(distance(from, to) / 0.1));
  for (let i = 1; i <= steps; i++) if (!walkable({ x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps })) return false;
  return occupied.every(point => segmentDistance(point, from, to) >= PET_SPACING - 1e-8);
}
/** Swept checks prevent passing through neighbours; a consistent side bias lets opposing walkers pass. */
export function advanceAvoiding(from: FloorPoint, target: FloorPoint, elapsed: number, occupied: readonly FloorPoint[]) {
  const direct = advancePoint(from, target, elapsed);
  if (clearMovement(from, direct, occupied)) return { ...direct, blocked: false };
  const length = 3.5 * Math.max(0, Math.min(elapsed, 0.07));
  const angle = Math.atan2(target.z - from.z, target.x - from.x);
  for (const turn of [Math.PI / 2, Math.PI / 3, -Math.PI / 2, -Math.PI / 3]) {
    const point = { x: from.x + Math.cos(angle + turn) * length, z: from.z + Math.sin(angle + turn) * length };
    if (clearMovement(from, point, occupied)) return { ...point, arrived: false, blocked: true };
  }
  return { ...from, arrived: false, blocked: true };
}
