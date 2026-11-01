import type { OfficeAgent } from '../shared/contract';
import type { Point, Rect } from './layout';

export type FamilyAgent = Pick<OfficeAgent, 'agentId' | 'parentAgentId' | 'runtimeState'>;
export interface FamilyProximityInput {
  agents: readonly FamilyAgent[];
  /** Settled destinations of actually rendered pets, before any meeting override.
   * Baseline destinations must already be separated and within bounds. */
  positions: ReadonlyMap<string, Point>;
  bounds: Rect;
  /** Minimum separation of centers on either axis, including the pet footprint. */
  spacing: Point;
  /** Explicit finite neighborhood: 1–4 grid steps on either axis. */
  maxRings: number;
  /** All allocated homes, including hidden pets and meeting return destinations. */
  reservedHomes?: ReadonlyMap<string, Point>;
  /** E.g. both water-cooler endpoints; these never become family anchors. */
  reservedPoints?: readonly Point[];
  /** Keep these supplied settled destinations fixed, e.g. captured meeting returns. */
  fixedAgentIds?: ReadonlySet<string>;
}
export type FamilyPlacement = 'nearby' | 'no-room' | 'fixed' | 'cyclic-parent';
export interface FamilyProximityPlan {
  positions: ReadonlyMap<string, Point>;
  /** Only observed working children with a rendered parent have an outcome. */
  outcomes: ReadonlyMap<string, FamilyPlacement>;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * Presentation-only, deterministic and stateless. Roots stay at their supplied
 * destinations; working children search around their immediate visible parent.
 * Source homes remain reserved, so neither hidden pets nor a returning meeting
 * pair loses its desk. No free candidate means no move; pre-existing invalid
 * baseline positions are not repaired here. New destinations never add overlap.
 * The caller owns lifecycle, visibility, motion and the final meeting override.
 */
export function planFamilyProximity(input: FamilyProximityInput): FamilyProximityPlan {
  const { bounds, spacing, maxRings } = input;
  if (!finitePoint(bounds) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
    || bounds.width <= 0 || bounds.height <= 0 || !finitePoint(spacing) || spacing.x <= 0 || spacing.y <= 0
    || !Number.isInteger(maxRings) || maxRings < 1 || maxRings > 4) {
    throw new RangeError('Family proximity requires finite bounds, positive spacing and 1–4 search rings.');
  }
  const positions = new Map([...input.positions].sort(([a], [b]) => compare(a, b)).map(([id, point]) => {
    if (!finitePoint(point)) throw new RangeError('Family positions must be finite.');
    return [id, { ...point }] as const;
  }));
  const reservedHomes = [...input.reservedHomes ?? []];
  const reservedPoints = input.reservedPoints ?? [];
  if (![...reservedHomes.map(([, point]) => point), ...reservedPoints].every(finitePoint)) {
    throw new RangeError('Family reservations must be finite.');
  }
  const agents = new Map<string, FamilyAgent>();
  const duplicates = new Set<string>();
  for (const agent of input.agents) {
    if (agents.has(agent.agentId)) duplicates.add(agent.agentId);
    else agents.set(agent.agentId, agent);
  }
  // Ambiguous source identities may occupy supplied positions, but cannot form
  // edges. Choosing the first duplicate would make ancestry depend on input order.
  for (const id of duplicates) agents.delete(id);
  const parentOf = (id: string): string | null => {
    const parent = agents.get(id)?.parentAgentId;
    return parent && agents.has(parent) && positions.has(parent) ? parent : null;
  };
  const depths = new Map<string, number | null>();
  for (const id of positions.keys()) {
    if (depths.has(id)) continue;
    const path: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null && !depths.has(cursor) && !seen.has(cursor)) {
      path.push(cursor);
      seen.add(cursor);
      cursor = parentOf(cursor);
    }
    let depth: number | null = cursor === null ? -1 : seen.has(cursor) ? null : depths.get(cursor)!;
    // Cycles and branches entering them remain anchored; no invented family root.
    for (const member of path.reverse()) {
      depth = depth === null ? null : depth + 1;
      depths.set(member, depth);
    }
  }
  const overlaps = (a: Point, b: Point) => Math.abs(a.x - b.x) < spacing.x && Math.abs(a.y - b.y) < spacing.y;
  const inside = (point: Point) => point.x - spacing.x / 2 >= bounds.x && point.y - spacing.y / 2 >= bounds.y
    && point.x + spacing.x / 2 <= bounds.x + bounds.width && point.y + spacing.y / 2 <= bounds.y + bounds.height;
  const nearby = (a: Point, b: Point) => Math.abs(a.x - b.x) <= maxRings * spacing.x
    && Math.abs(a.y - b.y) <= maxRings * spacing.y;
  const distanceSquared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const free = (id: string, point: Point) => {
    if (!inside(point) || reservedPoints.some(other => overlaps(point, other))
      || reservedHomes.some(([owner, other]) => owner !== id && overlaps(point, other))) return false;
    for (const [owner, other] of positions) if (owner !== id && overlaps(point, other)) return false;
    return true;
  };
  const offsets: Point[] = [];
  for (let y = -maxRings; y <= maxRings; y++) for (let x = -maxRings; x <= maxRings; x++) {
    if (x !== 0 || y !== 0) offsets.push({ x: x * spacing.x, y: y * spacing.y });
  }
  offsets.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || a.y - b.y || a.x - b.x);
  const outcomes = new Map<string, FamilyPlacement>();
  const ordered = [...positions.keys()].sort((a, b) => (depths.get(a) ?? Infinity) - (depths.get(b) ?? Infinity) || compare(a, b));
  for (const id of ordered) {
    const agent = agents.get(id);
    const parentId = parentOf(id);
    if (agent?.runtimeState !== 'working' || !parentId) continue;
    if (depths.get(id) === null) { outcomes.set(id, 'cyclic-parent'); continue; }
    if (input.fixedAgentIds?.has(id)) { outcomes.set(id, 'fixed'); continue; }
    const current = positions.get(id)!;
    const parent = positions.get(parentId)!;
    // Preserve an already safe nearby desk rather than reordering a family.
    if (nearby(current, parent) && free(id, current)) { outcomes.set(id, 'nearby'); continue; }
    const next = offsets.map(offset => ({ x: parent.x + offset.x, y: parent.y + offset.y }))
      .find(point => distanceSquared(point, parent) < distanceSquared(current, parent) && free(id, point));
    if (next) {
      positions.set(id, next);
      outcomes.set(id, 'nearby');
    } else outcomes.set(id, 'no-room');
  }
  return { positions, outcomes };
}
