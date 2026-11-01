import { useLayoutEffect, useRef, useState } from 'react';
import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import type { Meeting, MeetingToken } from '../office/handoffs/meeting-queue';
import officeBackground from '../../assets/office/office-v1.png';
import { attentionFor, nativeAssetFor } from './view-model';
import { NativePet } from './NativePet';
import './handoffs.css';

export interface OfficeSceneProps {
  snapshot: OfficeSnapshot | null;
  selectedAgentId: string | null;
  visibleAgents: OfficeAgent[];
  onSelectAgent(agentId: string): void;
  meeting?: Meeting | null;
  onMeetingComplete?(token: MeetingToken): void;
  hiddenHandoffCount?: number;
}

type MeetingPhase = 'approaching' | 'exchanging' | 'returning' | 'complete';
const WALK_MS = 1100;
const EXCHANGE_MS = 4000;
const HOME_POINTS = [[24, 27], [71, 31], [24, 67], [71, 69], [12, 37], [87, 45], [46, 32], [55, 71]];

/** Identity-only anchors remain stable when another pet hides or the roster reorders. */
function homePoint(agentId: string) {
  let hash = 2166136261;
  for (const character of agentId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const anchor = HOME_POINTS[hash % HOME_POINTS.length];
  return [anchor[0] + ((hash >>> 4) % 5 - 2), anchor[1] + ((hash >>> 8) % 5 - 2)];
}

/** Replaceable scene boundary: the renderer only observes snapshots and reports selection. */
export function OfficeScene({ snapshot, selectedAgentId, visibleAgents, onSelectAgent, meeting = null, onMeetingComplete, hiddenHandoffCount = 0 }: OfficeSceneProps) {
  const nativeAgents = snapshot ? visibleAgents.filter(agent => agent.runtimeState !== 'closed' && nativeAssetFor(agent, snapshot.petAssets)) : [];
  const state = snapshot?.presentation.state ?? 'ready';
  const sessionId = snapshot?.officeSessionId ?? '';
  const key = meeting ? JSON.stringify([meeting.token.generation, meeting.token.serial, meeting.token.handoffId]) : '';
  const pair = meeting ? [meeting.handoff.fromAgentId, meeting.handoff.toAgentId] : [];
  const available = !!meeting && state === 'live' && pair.every(id => visibleAgents.some(agent => agent.agentId === id && agent.runtimeState !== 'closed' && agent.runtimeState !== 'error'));
  const [ceremony, setCeremony] = useState<{ key: string; phase: MeetingPhase } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const latestComplete = useRef(onMeetingComplete);
  const run = useRef<{ key: string; sessionId: string; cancelled: boolean } | null>(null);
  useLayoutEffect(() => { latestComplete.current = onMeetingComplete; }, [onMeetingComplete]);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    if (!meeting || !available || (run.current?.key === key && (run.current.cancelled || run.current.sessionId !== sessionId))) {
      if (run.current?.key === key) run.current.cancelled = true;
      setCeremony(null);
      return;
    }
    const token = { ...meeting.token };
    const current = { key, sessionId, cancelled: false };
    run.current = current;
    const active = () => run.current === current && !current.cancelled;
    setCeremony({ key, phase: reducedMotion ? 'exchanging' : 'approaching' });
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!reducedMotion) {
      timers.push(setTimeout(() => { if (active()) setCeremony({ key, phase: 'exchanging' }); }, WALK_MS));
      timers.push(setTimeout(() => { if (active()) setCeremony({ key, phase: 'returning' }); }, WALK_MS + EXCHANGE_MS));
    }
    timers.push(setTimeout(() => {
      if (!active()) return;
      setCeremony({ key, phase: 'complete' });
      current.cancelled = true;
      latestComplete.current?.(token);
    }, reducedMotion ? EXCHANGE_MS : WALK_MS * 2 + EXCHANGE_MS));
    return () => { current.cancelled = true; timers.forEach(clearTimeout); };
    // The token owns the ceremony. Polling produces new meeting objects without
    // restarting its clock; callbacks are read through the latest ref above.
    // Sample reduced motion when the ceremony starts. CSS responds immediately
    // to later preference changes without cancelling the queue's active token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, available, sessionId]);
  const phase = available && ceremony?.key === key && ceremony.phase !== 'complete' ? ceremony.phase : 'none';
  const activeMeeting = phase !== 'none' ? meeting : null;
  const atCooler = phase === 'approaching' || phase === 'exchanging';
  const from = visibleAgents.find(agent => agent.agentId === meeting?.handoff.fromAgentId);
  const to = visibleAgents.find(agent => agent.agentId === meeting?.handoff.toAgentId);
  return <div className="office-scene" data-testid="office-scene" data-presentation={state} data-meeting={activeMeeting?.handoff.handoffId ?? ''} data-meeting-phase={phase} data-reduced-motion={reducedMotion} aria-label="Office scene">
    <img className="office-background" src={officeBackground} alt="An open-plan office with four desk areas, a central gathering rug, reading corners and sofas" />
    <div className="scene-grain" />
    <div className="scene-floor-tag"><span /> THE SHARED OFFICE <span className="floor-separator">/</span> FLOOR 01</div>
    {hiddenHandoffCount > 0 && <div className="hidden-handoff-count" data-testid="hidden-handoff-count" role="status">{hiddenHandoffCount} {hiddenHandoffCount === 1 ? 'handoff involves' : 'handoffs involve'} hidden pets</div>}
    {activeMeeting && <div className="handoff-meeting" data-testid="handoff-meeting" data-handoff-id={activeMeeting.handoff.handoffId} data-phase={phase}>
      <span className="handoff-location">WATER COOLER</span>
      {phase === 'exchanging' && <div className="handoff-bubble" role="status"><span className="handoff-participants">{from?.displayName} <span aria-hidden="true">→</span> {to?.displayName}</span><p data-testid="handoff-summary">{activeMeeting.handoff.summary || 'Handoff observed; summary unavailable from this source.'}</p></div>}
    </div>}
    {nativeAgents.map(agent => {
      const asset = nativeAssetFor(agent, snapshot!.petAssets)!;
      const home = homePoint(agent.agentId);
      const participantIndex = activeMeeting ? pair.indexOf(agent.agentId) : -1;
      const point = participantIndex !== -1 && atCooler ? [participantIndex === 0 ? 48 : 59, 36] : home;
      return <button key={agent.agentId} className={`scene-agent ${selectedAgentId === agent.agentId ? 'is-selected' : ''}`} data-testid={`scene-agent-${agent.agentId}`} data-meeting-participant={participantIndex !== -1} data-location={participantIndex !== -1 && atCooler ? 'water-cooler' : 'home'} data-home-left={`${home[0]}%`} data-home-top={`${home[1]}%`} aria-label={`Inspect ${agent.displayName}`} aria-pressed={selectedAgentId === agent.agentId} style={{ left: `${point[0]}%`, top: `${point[1]}%` }} onClick={() => onSelectAgent(agent.agentId)}>
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
