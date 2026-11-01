import type { FloorPoint } from './navigation';

/** RAF timestamps may precede setup's performance.now() on the first frame. */
export function advancePoint(from: FloorPoint, target: FloorPoint, elapsedSeconds: number) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  const speed = 3.5 * Math.max(0, Math.min(elapsedSeconds, 0.07));
  if (distance <= 1e-6 || distance <= speed) return { ...target, arrived: true };
  return { x: from.x + dx / distance * speed, z: from.z + dz / distance * speed, arrived: false };
}
