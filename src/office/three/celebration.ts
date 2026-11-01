import type { OfficeSnapshot } from '../../shared/contract';
import { withDemoAgents } from './demo';

export const celebrationDurations = { entering: 5000, working: 5000, cheering: 3000, leaving: 7000 } as const;
export type CelebrationPhase = keyof typeof celebrationDurations;
export interface CelebrationRun { id: string; phase: CelebrationPhase }
export function celebrationPhase(elapsedMs: number): CelebrationPhase | 'idle' {
  let boundary = 0;
  for (const [phase, duration] of Object.entries(celebrationDurations)) {
    boundary += duration;
    if (elapsedMs < boundary) return phase as CelebrationPhase;
  }
  return 'idle';
}

export function withCelebrationAgents(snapshot: OfficeSnapshot | null, phase: CelebrationPhase | 'idle') {
  if (phase === 'idle') return null;
  const view = withDemoAgents(snapshot, 0);
  const descriptions = { entering: 'Arriving for the celebration', working: 'Finishing the team’s demo work',
    cheering: 'Celebrating together!', leaving: 'Heading out after a successful demo' };
  const agents = view.agents.map(agent => ({ ...agent, runtimeState: 'working' as const,
    task: `Simulated activity: ${descriptions[phase]}.`,
    recentActivity: agent.recentActivity.map(activity => ({ ...activity, summary: `Demo celebration: ${descriptions[phase]}` })) }));
  const ids = new Set(agents.map(agent => agent.agentId));
  return { agents, snapshot: { ...view.snapshot, agents: [...view.snapshot.agents.filter(agent => !ids.has(agent.agentId)), ...agents] } };
}
