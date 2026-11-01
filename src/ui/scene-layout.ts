import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import type { SpriteLifecycle } from '../office/lifecycle/controller';
import { DEFAULT_OFFICE_GEOMETRY, type OfficeGeometry, type OfficeLayout, type Point } from '../office/layout';
import { createSeatAssignments } from '../office/seating';

export interface SceneLayout extends OfficeLayout { rests: Map<string, Point> }

/** Historical completed turns claim no chair until they appear. An assigned
 * chair survives a turn's absence, while an actual departure releases it. */
export function createSceneLayout(config: Partial<OfficeGeometry> = {}) {
  const geometry = structuredClone({ ...DEFAULT_OFFICE_GEOMETRY, ...config });
  const deskSeats = createSeatAssignments('desk');
  const restSeats = createSeatAssignments('rest');
  const assigned = new Set<string>();
  return {
    map(snapshot: Pick<OfficeSnapshot, 'agents' | 'projects' | 'pendingRequests'>, lifecycles: readonly SpriteLifecycle[], candidateIds: ReadonlySet<string>): SceneLayout {
      const states = new Map(lifecycles.map(life => [life.agentId, life]));
      const present = new Set(snapshot.agents.filter(agent => (agent.runtimeState !== 'closed' || states.get(agent.agentId)?.phase === 'dying')).map(agent => agent.agentId));
      for (const id of assigned) if (!present.has(id)) assigned.delete(id);
      const eligible = (agent: OfficeAgent) => candidateIds.has(agent.agentId) && (agent.runtimeState !== 'closed' || states.get(agent.agentId)?.phase === 'dying') && (
        agent.pendingRequestIds.length > 0 || agent.runtimeState === 'waiting-for-input' || agent.runtimeState === 'waiting-for-approval'
        || snapshot.pendingRequests.some(request => request.agentId === agent.agentId) || states.get(agent.agentId)?.visible !== false);
      for (const agent of snapshot.agents) if (eligible(agent)) assigned.add(agent.agentId);
      // Projects remain source metadata. Every visible family shares the actual
      // artwork chairs, with extra desks/benches allocated beyond the artwork.
      const occupants = snapshot.agents.filter(agent => assigned.has(agent.agentId));
      const homes = deskSeats(occupants.map(agent => agent.agentId));
      const rests = restSeats(occupants.filter(agent => agent.runtimeState === 'idle').map(agent => agent.agentId));
      const points = [...homes.values(), ...rests.values()];
      return {
        width: Math.max(geometry.canvas.width, ...points.map(point => point.x + 60)),
        height: Math.max(geometry.canvas.height, ...points.map(point => point.y + 60)),
        homes, rests, areas: [],
        entrance: { ...geometry.entrance }, standup: { ...geometry.standup },
        waterCooler: [{ ...geometry.waterCooler[0] }, { ...geometry.waterCooler[1] }], rest: { ...geometry.rest },
      };
    },
  };
}
