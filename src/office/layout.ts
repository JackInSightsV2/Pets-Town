import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';

export interface AgentGroup {
  key: string;
  projectId: string;
  parent: OfficeAgent | null;
  children: OfficeAgent[];
  unparented: boolean;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Every observed identity appears once, including broken or cyclic ancestry. */
export function buildAgentGroups(agents: readonly OfficeAgent[]): AgentGroup[] {
  const unique = new Map<string, OfficeAgent>();
  for (const agent of agents) if (!unique.has(agent.agentId)) unique.set(agent.agentId, agent);
  type Root = { key: string; projectId: string; parentId: string | null };
  const roots = new Map<string, Root>();
  const groups = new Map<string, AgentGroup>();
  for (const agent of [...unique.values()].sort((a, b) => compare(a.agentId, b.agentId))) {
    const path: string[] = [];
    const visited = new Map<string, number>();
    let current = agent;
    let root: Root;
    for (;;) {
      const known = roots.get(current.agentId);
      if (known) { root = known; break; }
      const cycle = visited.get(current.agentId);
      if (cycle !== undefined) {
        const parentId = path.slice(cycle).sort(compare)[0];
        root = { key: JSON.stringify([agent.projectId, 'root', parentId]), projectId: agent.projectId, parentId };
        break;
      }
      visited.set(current.agentId, path.length);
      path.push(current.agentId);
      if (!current.parentAgentId) {
        root = { key: JSON.stringify([agent.projectId, 'root', current.agentId]), projectId: agent.projectId, parentId: current.agentId };
        break;
      }
      const parent = unique.get(current.parentAgentId);
      if (!parent || parent.projectId !== agent.projectId) {
        root = { key: JSON.stringify([agent.projectId, 'missing', current.parentAgentId]), projectId: agent.projectId, parentId: null };
        break;
      }
      current = parent;
    }
    for (const id of path) roots.set(id, root);
    let group = groups.get(root.key);
    if (!group) {
      group = { key: root.key, projectId: root.projectId, parent: root.parentId ? unique.get(root.parentId)! : null,
        children: [], unparented: root.parentId === null };
      groups.set(root.key, group);
    }
    if (agent.agentId !== root.parentId) group.children.push(agent);
  }
  return [...groups.values()].sort((a, b) => compare(a.projectId, b.projectId) || compare(a.key, b.key));
}

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
/** Logical pixels; points are pet centers. Keep rendered pet footprints <= spacing. */
export interface OfficeGeometry {
  canvas: { width: number; height: number };
  areas: readonly Rect[];
  entrance: Point;
  standup: Point;
  waterCooler: readonly [Point, Point];
  rest: Point;
  spacing: Point;
  padding: number;
  gap: number;
}
export const DEFAULT_OFFICE_GEOMETRY: OfficeGeometry = {
  canvas: { width: 1000, height: 720 },
  areas: [
    { x: 32, y: 150, width: 448, height: 160 }, { x: 520, y: 150, width: 448, height: 160 },
    { x: 32, y: 450, width: 448, height: 160 }, { x: 520, y: 450, width: 448, height: 160 },
  ],
  entrance: { x: 500, y: 660 }, standup: { x: 500, y: 350 },
  waterCooler: [{ x: 460, y: 350 }, { x: 580, y: 350 }], rest: { x: 500, y: 560 },
  spacing: { x: 112, y: 112 }, padding: 56, gap: 32,
};
export interface ProjectArea extends Rect { projectId: string; overflow: boolean }
export interface OfficeLayout {
  width: number;
  height: number;
  homes: ReadonlyMap<string, Point>;
  areas: ProjectArea[];
  entrance: Point;
  standup: Point;
  waterCooler: readonly [Point, Point];
  rest: Point;
}
export interface OfficeLayoutMapper {
  map(snapshot: Pick<OfficeSnapshot, 'agents' | 'projects'>): OfficeLayout;
}

/**
 * Retain one mapper in useRef for the office lifetime, and always pass all source
 * agents/projects. Artwork rectangles seed finite slots; overflow uses separate
 * unbounded columns to their right. Never reuse departed identities' slots.
 * Changing an agent's source project moves only that agent to its new area.
 * Recreate the mapper only when intentionally replacing the geometry.
 */
export function createOfficeLayout(config: Partial<OfficeGeometry> = {}): OfficeLayoutMapper {
  const geometry: OfficeGeometry = structuredClone({ ...DEFAULT_OFFICE_GEOMETRY, ...config });
  const { spacing, padding, gap } = geometry;
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const point = (value: Point) => Number.isFinite(value.x) && value.x >= 0 && Number.isFinite(value.y) && value.y >= 0;
  if (!positive(geometry.canvas.width) || !positive(geometry.canvas.height) || !positive(spacing.x) || !positive(spacing.y)
    || !Number.isFinite(padding) || padding < Math.max(spacing.x, spacing.y) / 2 || !Number.isFinite(gap) || gap < 0
    || geometry.waterCooler.length !== 2 || ![geometry.entrance, geometry.standup, geometry.rest, ...geometry.waterCooler].every(point)) {
    throw new RangeError('Office geometry requires finite positive dimensions, non-negative points, and padding of at least half the spacing.');
  }
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const [index, area] of geometry.areas.entries()) {
    if (!point(area) || !Number.isFinite(area.width) || !Number.isFinite(area.height) || area.width < padding * 2 || area.height < padding * 2
      || geometry.areas.slice(0, index).some(previous => overlaps(area, previous))) throw new RangeError('Office areas must have room for a pet and must not overlap.');
  }
  const columns = (area: Rect) => Math.floor((area.width - padding * 2) / spacing.x) + 1;
  const rows = (area: Rect) => Math.floor((area.height - padding * 2) / spacing.y) + 1;
  const home = (area: Rect, index: number): Point => ({ x: area.x + padding + (index % columns(area)) * spacing.x,
    y: area.y + padding + Math.floor(index / columns(area)) * spacing.y });
  const landmarks = [geometry.entrance, geometry.standup, geometry.rest, ...geometry.waterCooler];
  const overflowWidth = padding * 2 + spacing.x * 2;
  const overflowLeft = Math.max(geometry.canvas.width, ...geometry.areas.map(area => area.x + area.width), ...landmarks.map(point => point.x + padding)) + gap;
  const overflowTop = geometry.areas.length ? Math.min(...geometry.areas.map(area => area.y)) : padding;
  type Allocation = { base: Rect | null; overflow: Rect | null; slots: Map<string, Point> };
  const allocations = new Map<string, Allocation>();
  let overflowCount = 0;
  let width = Math.max(geometry.canvas.width, ...geometry.areas.map(area => area.x + area.width + gap), ...landmarks.map(point => point.x + padding));
  let height = Math.max(geometry.canvas.height, ...geometry.areas.map(area => area.y + area.height + gap), ...landmarks.map(point => point.y + padding));
  function overflow(allocation: Allocation): Rect {
    if (!allocation.overflow) {
      allocation.overflow = { x: overflowLeft + overflowCount++ * (overflowWidth + gap), y: overflowTop,
        width: overflowWidth, height: padding * 2 };
    }
    return allocation.overflow;
  }
  return {
    map(snapshot) {
      const projectIds = new Set([...snapshot.projects.map(project => project.projectId), ...snapshot.agents.map(agent => agent.projectId)]);
      for (const projectId of [...projectIds].sort(compare)) {
        if (allocations.has(projectId)) continue;
        const allocation: Allocation = { base: geometry.areas[allocations.size] ?? null, overflow: null, slots: new Map() };
        allocations.set(projectId, allocation);
        if (!allocation.base) overflow(allocation);
      }
      const homes = new Map<string, Point>();
      for (const group of buildAgentGroups(snapshot.agents)) {
        const allocation = allocations.get(group.projectId)!;
        for (const agent of [...(group.parent ? [group.parent] : []), ...group.children]) {
          let position = allocation.slots.get(agent.agentId);
          if (!position) {
            const index = allocation.slots.size;
            const capacity = allocation.base ? columns(allocation.base) * rows(allocation.base) : 0;
            const area = index < capacity ? allocation.base! : overflow(allocation);
            position = home(area, index < capacity ? index : index - capacity);
            if (area === allocation.overflow) area.height = Math.max(area.height, position.y - area.y + padding);
            allocation.slots.set(agent.agentId, position);
          }
          homes.set(agent.agentId, { ...position });
        }
      }
      const areas: ProjectArea[] = [];
      for (const [projectId, allocation] of allocations) {
        for (const [area, isOverflow] of [[allocation.base, false], [allocation.overflow, true]] as const) {
          if (!area) continue;
          width = Math.max(width, area.x + area.width + gap);
          height = Math.max(height, area.y + area.height + gap);
          if (projectIds.has(projectId)) areas.push({ ...area, projectId, overflow: isOverflow });
        }
      }
      return { width, height, homes, areas, entrance: { ...geometry.entrance }, standup: { ...geometry.standup },
        waterCooler: [{ ...geometry.waterCooler[0] }, { ...geometry.waterCooler[1] }], rest: { ...geometry.rest } };
    },
  };
}
