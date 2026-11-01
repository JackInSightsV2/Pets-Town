import { emptySnapshot, type OfficeAgent, type OfficeSnapshot } from '../../shared/contract';
import { demoPets } from '../../shared/pets';

const PREFIX = 'petstown-demo:';
export const demoPetIds = ['dewey', 'fireball', 'hoots', 'rocky', 'seedy', 'stacky', 'bsod', 'null-signal'] as const;
export const isDemoAgent = (id: string | null): boolean => !!id && id.startsWith(PREFIX);
const activities = [
  { task: 'Writing the landing page', kind: 'editing', animation: 'review', x: -4, z: -6 },
  { task: 'Reviewing a pull request', kind: 'reading', animation: 'review', x: -4.6, z: -2.5 },
  { task: 'Researching a new idea', kind: 'researching', animation: 'idle', x: -6.5, z: -3.7 },
  { task: 'Sharing notes at the water cooler', kind: 'communicating', animation: 'waving', x: 6.2, z: 2.3 },
  { task: 'Walking over to the design team', kind: 'communicating', animation: 'waving', x: 0.3, z: 4.9 },
  { task: 'Celebrating a passing build', kind: 'running-command', animation: 'jumping', x: 1.8, z: 0 },
  { task: 'Taking a short coffee break', kind: 'unknown', animation: 'idle', x: 4.6, z: 4.9 },
  { task: 'Resting before the next task', kind: 'unknown', animation: 'waiting', x: -1.8, z: 2.6 },
] as const;

export function demoActivity(id: string, step: number) {
  const index = demoPetIds.findIndex(pet => `${PREFIX}${pet}` === id);
  if (index < 0) return null;
  const phase = ((Math.floor(step) + index) % activities.length + activities.length) % activities.length;
  return { ...activities[phase], idle: phase >= 6, phase };
}

/** View-only actors: never write to the observed store, its sequence, or host context. */
export function withDemoAgents(snapshot: OfficeSnapshot | null, step: number) {
  const source = snapshot ?? emptySnapshot('demo-view');
  const agents: OfficeAgent[] = demoPetIds.map(pet => {
    const id = `${PREFIX}${pet}`, activity = demoActivity(id, step)!;
    const name = demoPets.find(asset => asset.assetId === pet)?.name ?? pet;
    return { agentId: id, parentAgentId: null, projectId: `${PREFIX}office`, displayName: `${name} · Demo`,
      role: 'Simulated teammate', task: `Simulated activity: ${activity.task}.`, runtimeState: activity.idle ? 'idle' : 'working',
      activityKind: activity.kind, lastObservedAt: null, pendingRequestIds: [], petAssetId: pet,
      recentActivity: [{ activityId: `${id}:${step}`, agentId: id, kind: activity.kind, summary: `Demo: ${activity.task}`,
        occurredAt: '1970-01-01T00:00:00.000Z', sourceItemId: null, source: 'fixture' }] };
  });
  const assets = new Map(source.petAssets.map(asset => [asset.assetId, asset]));
  for (const pet of demoPets) if (!assets.has(pet.assetId)) assets.set(pet.assetId, pet);
  return { agents, snapshot: { ...source, agents: [...source.agents, ...agents],
    projects: [...source.projects, { projectId: `${PREFIX}office`, displayName: 'Demo office', cwd: null }], petAssets: [...assets.values()] } };
}
