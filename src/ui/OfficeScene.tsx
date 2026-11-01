import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import officeBackground from '../../assets/office/office-v1.png';
import { attentionFor, nativeAssetFor } from './view-model';
import { NativePet } from './NativePet';

export interface OfficeSceneProps {
  snapshot: OfficeSnapshot | null;
  selectedAgentId: string | null;
  visibleAgents: OfficeAgent[];
  onSelectAgent(agentId: string): void;
}

/** Replaceable scene boundary: the renderer only observes snapshots and reports selection. */
export function OfficeScene({ snapshot, selectedAgentId, visibleAgents, onSelectAgent }: OfficeSceneProps) {
  const nativeAgents = snapshot ? visibleAgents.filter(agent => agent.runtimeState !== 'closed' && nativeAssetFor(agent, snapshot.petAssets)) : [];
  const state = snapshot?.presentation.state ?? 'ready';
  const points = [[24, 27], [71, 31], [24, 67], [71, 69], [12, 37], [87, 45], [46, 32], [55, 71]];
  return <div className="office-scene" data-testid="office-scene" data-presentation={state} aria-label="Office scene">
    <img className="office-background" src={officeBackground} alt="An open-plan office with four desk areas, a central gathering rug, reading corners and sofas" />
    <div className="scene-grain" />
    <div className="scene-floor-tag"><span /> THE SHARED OFFICE <span className="floor-separator">/</span> FLOOR 01</div>
    {nativeAgents.map((agent, index) => {
      const asset = nativeAssetFor(agent, snapshot!.petAssets)!;
      const point = points[index % points.length];
      return <button key={agent.agentId} className={`scene-agent ${selectedAgentId === agent.agentId ? 'is-selected' : ''}`} data-testid={`scene-agent-${agent.agentId}`} aria-label={`Inspect ${agent.displayName}`} aria-pressed={selectedAgentId === agent.agentId} style={{ left: `${point[0]}%`, top: `${point[1]}%` }} onClick={() => onSelectAgent(agent.agentId)}>
        {attentionFor(agent, snapshot!).count > 0 && <span className="scene-attention" aria-label="Unresolved request">!</span>}
        <NativePet asset={asset} state={agent.runtimeState} />
        <span className="scene-agent-label">{agent.displayName}</span>
      </button>;
    })}
    {nativeAgents.length === 0 && <div className="scene-empty" data-testid="native-pet-empty-state">
      <span className="eyebrow">THE SPACE IS READY</span>
      <strong>{snapshot?.agents.length ? 'Your agents are in the roster.' : 'A place for your working agents.'}</strong>
      <p>{snapshot?.agents.length ? 'Native pet artwork is not available for these agents yet. Select an agent below to inspect its observed activity.' : 'Connected Codex agents will appear here when a supported source is available.'}</p>
    </div>}
    <div className="scene-caption"><span className="scene-caption-dot" /> {nativeAgents.length ? 'Pet assets: ChatGPT / Codex' : 'Office environment · native pets only'}<span>Presentation never pauses agent work</span></div>
  </div>;
}
