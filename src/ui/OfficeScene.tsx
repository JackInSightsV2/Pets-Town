import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import type { Meeting, MeetingToken } from '../office/handoffs/meeting-queue';
import { DEFAULT_OFFICE_GEOMETRY, type OfficeGeometry, type Point } from '../office/layout';
import officeBackground from '../../assets/office/office-v1.png';
import { attentionFor, nativeAssetFor, observedStatusLabel } from './view-model';
import { NativePet } from './NativePet';
import { useOfficeBehavior, useSceneLifecycles } from './useOfficeBehavior';
import { createSceneLayout } from './scene-layout';
import './seating.css';
import './handoffs.css';
import './layout.css';
import './movement.css';
import './behavior.css';

export interface OfficeSceneProps {
  snapshot: OfficeSnapshot | null;
  selectedAgentId: string | null;
  visibleAgents: OfficeAgent[];
  onSelectAgent(agentId: string, anchor?: Point): void;
  meeting?: Meeting | null;
  onMeetingComplete?(token: MeetingToken): void;
  hiddenHandoffCount?: number;
  geometry?: Partial<OfficeGeometry>;
  observerConnected?: boolean;
  autoFrame?: boolean;
}

function PetHint({ agent, anchor, statusLabel }: { agent: OfficeAgent; anchor: Point; statusLabel: string }) {
  const tooltip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const bounds = tooltip.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({ x: Math.max(10, Math.min(anchor.x - bounds.width / 2, window.innerWidth - bounds.width - 10)),
      y: Math.max(10, Math.min(anchor.y - bounds.height - 8, window.innerHeight - bounds.height - 10)) });
  }, [anchor.x, anchor.y, agent.displayName, statusLabel]);
  return <div ref={tooltip} className="pet-tooltip" role="tooltip" style={{ left: position.x, top: position.y }}><strong>{agent.displayName}</strong><span>{statusLabel}</span></div>;
}
function spreadPoint(index: number, anchor: Point, geometry: OfficeGeometry, fromBottom = false): Point {
  const padding = Math.max(60, geometry.padding);
  const columns = Math.max(1, Math.min(5, Math.floor((geometry.canvas.width - padding * 2) / geometry.spacing.x) + 1));
  const column = index % columns;
  const offset = column === 0 ? 0 : Math.ceil(column / 2) * (column % 2 ? -1 : 1);
  const left = Math.floor(columns / 2) * geometry.spacing.x;
  const right = Math.floor((columns - 1) / 2) * geometry.spacing.x;
  const center = Math.max(padding + left, Math.min(anchor.x, geometry.canvas.width - padding - right));
  const row = Math.floor(index / columns);
  const y = Math.max(padding, anchor.y);
  const rowsAbove = Math.floor((y - padding) / geometry.spacing.y);
  return { x: center + offset * geometry.spacing.x,
    y: fromBottom && row <= rowsAbove ? y - row * geometry.spacing.y : y + (fromBottom ? row - rowsAbove : row) * geometry.spacing.y };
}
/** Replaceable scene boundary: the renderer only observes snapshots and reports selection. */
export function OfficeScene({ snapshot, selectedAgentId, visibleAgents, onSelectAgent, meeting = null, onMeetingComplete, geometry, observerConnected = true, autoFrame = true }: OfficeSceneProps) {
  const [hover, setHover] = useState<{ agentId: string; anchor: Point } | null>(null);
  const geometryKey = JSON.stringify(geometry ?? {});
  const allocator = useRef<{ key: string; mapper: ReturnType<typeof createSceneLayout> } | null>(null);
  if (!allocator.current || allocator.current.key !== geometryKey) allocator.current = { key: geometryKey, mapper: createSceneLayout(geometry) };
  const lifecycles = useSceneLifecycles();
  const dyingIds = new Set(lifecycles.filter(life => life.phase === 'dying').map(life => life.agentId));
  const candidates = [...visibleAgents, ...(snapshot?.agents.filter(agent => agent.runtimeState === 'closed' && dyingIds.has(agent.agentId) && !visibleAgents.some(row => row.agentId === agent.agentId)) ?? [])];
  const nativeAgents = snapshot ? candidates.filter(agent => (agent.runtimeState !== 'closed' || dyingIds.has(agent.agentId)) && nativeAssetFor(agent, snapshot.petAssets)) : [];
  const layout = allocator.current.mapper.map(snapshot ?? { agents: [], projects: [], pendingRequests: [] }, lifecycles,
    new Set(nativeAgents.map(agent => agent.agentId)));
  const sceneGeometry = { ...DEFAULT_OFFICE_GEOMETRY, ...geometry };
  const artworkCanvas = geometry?.canvas ?? DEFAULT_OFFICE_GEOMETRY.canvas;
  const state = snapshot?.presentation.state ?? 'ready';
  const sessionId = snapshot?.officeSessionId ?? '';
  const viewport = useRef<HTMLDivElement>(null);
  const formation = useRef<{ key: string; slots: Map<string, number> }>({ key: geometryKey, slots: new Map() });
  if (formation.current.key !== geometryKey) formation.current = { key: geometryKey, slots: new Map() };
  for (const id of [...layout.homes.keys()].sort()) if (!formation.current.slots.has(id)) formation.current.slots.set(id, formation.current.slots.size);
  const entrances = new Map<string, Point>();
  const standups = new Map<string, Point>();
  const rests = layout.rests;
  for (const [id, index] of formation.current.slots) {
    entrances.set(id, spreadPoint(index, layout.entrance, sceneGeometry, true));
    standups.set(id, spreadPoint(index, layout.standup, sceneGeometry));
  }
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const { placed, meeting: activeMeeting, meetingPhase: phase, checkIn, speech } = useOfficeBehavior({ snapshot,
    visibleAgents: nativeAgents, layout, geometry: sceneGeometry, entrances, standups, rests, meeting, reducedMotion }, onMeetingComplete, observerConnected);
  const hoveredAgent = hover && hover.agentId !== selectedAgentId ? placed.find(pet => pet.agent.agentId === hover.agentId)?.agent : null;
  const hasPets = placed.length > 0;
  const from = visibleAgents.find(agent => agent.agentId === meeting?.handoff.fromAgentId);
  const to = visibleAgents.find(agent => agent.agentId === meeting?.handoff.toAgentId);
  const cooler = layout.waterCooler;
  const extraDesks = [...layout.homes.values()].filter(point => point.x > artworkCanvas.width);
  const extraRests = [...rests.values()].filter(point => point.x > artworkCanvas.width);
  const worldWidth = Math.max(layout.width, ...placed.map(pet => pet.point.x + 60));
  const worldHeight = Math.max(layout.height, ...placed.map(pet => pet.point.y + 60));
  const refreshSelectedAnchor = () => {
    if (!selectedAgentId) return;
    const pet = viewport.current?.querySelector<HTMLElement>('.scene-agent[aria-pressed="true"]');
    if (!pet) return;
    const bounds = pet.getBoundingClientRect();
    onSelectAgent(selectedAgentId, { x: bounds.left + bounds.width / 2, y: bounds.bottom });
  };
  useLayoutEffect(() => {
    if (!autoFrame || !hasPets || !viewport.current) return;
    const view = viewport.current;
    if (state === 'ready') {
      view.scrollTop = Math.max(0, layout.entrance.y + 60 - view.clientHeight);
      view.scrollLeft = Math.max(0, layout.entrance.x - view.clientWidth / 2);
    } else if (state === 'arrivals') {
      // Keep the entrance origin in view while the pets approach the gathering.
      view.scrollTop = Math.max(0, Math.min(layout.standup.y - 120, layout.entrance.y + 60 - view.clientHeight));
    } else if (state === 'standup') {
      view.scrollTop = Math.max(0, layout.standup.y - view.clientHeight / 2);
    } else {
      // Fit desks and rest together when possible; preserve horizontal exploration.
      const points = placed.map(pet => pet.point);
      const top = Math.min(...points.map(point => point.y)) - 100;
      const bottom = Math.max(...points.map(point => point.y)) + 100;
      view.scrollTop = bottom - top <= view.clientHeight ? Math.max(0, (top + bottom - view.clientHeight) / 2) : 0;
    }
  }, [state, sessionId, hasPets, geometryKey, autoFrame]);
  return <div className="office-scene mapped-office" data-testid="office-scene" data-presentation={state} data-meeting={activeMeeting?.handoff.handoffId ?? ''} data-meeting-phase={phase} data-check-in={checkIn ? 'active' : ''} data-reduced-motion={reducedMotion} aria-label="Office scene">
    <div ref={viewport} className="office-map-viewport" data-testid="office-map-viewport" tabIndex={0} role="region" aria-label="Shared office map. Scroll to explore the office." onScroll={() => { setHover(null); refreshSelectedAnchor(); }}>
      <div className="office-map-surface" data-testid="office-map-surface" style={{ width: worldWidth, height: worldHeight }}>
        <img className="office-background office-map-artwork" src={officeBackground} style={{ width: artworkCanvas.width, height: artworkCanvas.height }} alt="One open-plan office with desk areas, a central gathering rug, reading corners and sofas" />
        <div className="scene-grain" />
        {extraDesks.map(point => <div key={`${point.x}:${point.y}`} className="overflow-desk" aria-hidden="true" style={{ left: point.x, top: point.y }}><span /></div>)}
        {extraRests.map(point => <div key={`${point.x}:${point.y}`} className="overflow-bench" aria-hidden="true" style={{ left: point.x, top: point.y }} />)}
        {activeMeeting && <div className="handoff-meeting" data-testid="handoff-meeting" data-handoff-id={activeMeeting.handoff.handoffId} data-phase={phase} style={{ left: (cooler[0].x + cooler[1].x) / 2, top: Math.max(48, Math.min(cooler[0].y, cooler[1].y) - 168) }}>
          <span className="handoff-location">WATER COOLER</span>
          {phase === 'exchanging' && <div className="handoff-bubble" role="status"><span className="handoff-participants">{from?.displayName} <span aria-hidden="true">→</span> {to?.displayName}</span><p data-testid="handoff-summary">{activeMeeting.handoff.summary || 'Handoff observed; summary unavailable from this source.'}</p></div>}
        </div>}
        {placed.map(({ agent, visualState, home, entrance, standup, participantIndex, location, point, animationName, lifecyclePhase, motion }) => {
          const asset = nativeAssetFor(agent, snapshot!.petAssets)!;
          const size = agent.parentAgentId ? 36 : 54;
          const style = { left: point.x, top: point.y, '--pet-size': `${size}px`, '--entrance-x': `${entrance.x}px`, '--entrance-y': `${entrance.y}px`, '--standup-x': `${standup.x}px`, '--standup-y': `${standup.y}px`, '--destination-x': `${point.x}px`, '--destination-y': `${point.y}px`, '--arrival-delay': `${Math.min(formation.current.slots.get(agent.agentId)! * 70, 560)}ms` } as CSSProperties;
          const showHint = (button: HTMLButtonElement) => { const bounds = button.getBoundingClientRect(); setHover({ agentId: agent.agentId, anchor: { x: bounds.left + bounds.width / 2, y: bounds.top } }); };
          return <button key={agent.agentId} className={`scene-agent ${selectedAgentId === agent.agentId ? 'is-selected' : ''}`} data-testid={`scene-agent-${agent.agentId}`} data-project-id={agent.projectId} data-meeting-participant={participantIndex !== -1} data-location={location} data-motion={motion} data-lifecycle-phase={lifecyclePhase} data-idle-sleep={agent.runtimeState === 'idle' && lifecyclePhase !== 'dying' && motion === 'settled' && participantIndex === -1 && attentionFor(agent, snapshot!).count === 0} data-animation={animationName ?? ''} data-runtime-state={agent.runtimeState} data-home-left={`${home.x}px`} data-home-top={`${home.y}px`} aria-label={`Inspect ${agent.displayName}`} aria-pressed={selectedAgentId === agent.agentId} style={style}
            onMouseEnter={event => showHint(event.currentTarget)} onMouseLeave={() => setHover(null)} onFocus={event => showHint(event.currentTarget)} onBlur={() => setHover(null)}
            onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(null); onSelectAgent(agent.agentId, { x: bounds.left + bounds.width / 2, y: bounds.bottom }); }}>
            {attentionFor(agent, snapshot!).count > 0 && <span className="scene-attention" aria-label="Unresolved request">!</span>}
            {agent.runtimeState === 'error' && <span className="scene-runtime-error" aria-label="Agent error">×</span>}
            <NativePet asset={asset} state={visualState} size={size} animationName={animationName} animationOnce={lifecyclePhase === 'dying'} />
            {speech?.agentId === agent.agentId && <span className="ambient-chatter" data-testid="ambient-chatter" aria-label={`Decorative office chatter: ${speech.text}`}><small>Small talk</small>{speech.text}</span>}
          </button>;
        })}
      </div>
    </div>
    {hoveredAgent && hover && snapshot && <PetHint agent={hoveredAgent} anchor={hover.anchor} statusLabel={observedStatusLabel(hoveredAgent, snapshot)} />}
  </div>;
}
