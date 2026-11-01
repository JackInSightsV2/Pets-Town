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
  const nativeAgents = snapshot ? visibleAgents.filter(agent => agent.runtimeState !== 'closed' && nativeAssetFor(agent, snapshot.petAssets)) : [];
  const layout = allocator.current.mapper.map(snapshot ?? { agents: [], projects: [], pendingRequests: [] }, lifecycles,
    new Set(nativeAgents.map(agent => agent.agentId)));
  const sceneGeometry = { ...DEFAULT_OFFICE_GEOMETRY, ...geometry };
  const artworkCanvas = geometry?.canvas ?? DEFAULT_OFFICE_GEOMETRY.canvas;
  const state = snapshot?.presentation.state ?? 'ready';
  const sessionId = snapshot?.officeSessionId ?? '';
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [artworkAspect, setArtworkAspect] = useState<number | null>(null);
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const measure = () => setViewportSize(previous => previous.width === view.clientWidth && previous.height === view.clientHeight
      ? previous : { width: view.clientWidth, height: view.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    return () => observer.disconnect();
  }, []);
  // The image is contained within the logical canvas. Cover its painted bounds,
  // then transform the entire world together so pets retain their map positions.
  const paintedWidth = artworkAspect ? Math.min(artworkCanvas.width, artworkCanvas.height * artworkAspect) : artworkCanvas.width;
  const paintedHeight = artworkAspect ? Math.min(artworkCanvas.height, artworkCanvas.width / artworkAspect) : artworkCanvas.height;
  const cameraScale = autoFrame ? Math.max(viewportSize.width / paintedWidth, viewportSize.height / paintedHeight, 0.01) : 1;
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
    const view = viewport.current;
    if (!autoFrame || !view || !viewportSize.width || !artworkAspect) return;
    const first = placed[0];
    view.scrollLeft = Math.max(0, (first?.point.x ?? paintedWidth / 2) * cameraScale - view.clientWidth / 2);
    view.scrollTop = Math.max(0, (paintedHeight * cameraScale - view.clientHeight) / 2);
    // Reveal the initial pet without relying on hover/click to auto-scroll it.
    // Later snapshots and handoffs leave the user's chosen camera untouched.
    const pet = view.querySelector<HTMLElement>('.scene-agent');
    if (pet) {
      const bounds = pet.getBoundingClientRect();
      const frame = view.getBoundingClientRect();
      const margin = 16;
      if (bounds.left < frame.left + margin) view.scrollLeft += bounds.left - frame.left - margin;
      else if (bounds.right > frame.right - margin) view.scrollLeft += bounds.right - frame.right + margin;
      if (bounds.top < frame.top + margin) view.scrollTop += bounds.top - frame.top - margin;
      else if (bounds.bottom > frame.bottom - margin) view.scrollTop += bounds.bottom - frame.bottom + margin;
    }
    refreshSelectedAnchor();
    // Reframe only on scene entry or viewport changes, never on source polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sessionId, hasPets, geometryKey, cameraScale, viewportSize.width, viewportSize.height, artworkAspect, autoFrame]);
  return <div className="office-scene mapped-office" data-testid="office-scene" data-presentation={state} data-meeting={activeMeeting?.handoff.handoffId ?? ''} data-meeting-phase={phase} data-check-in={checkIn ? 'active' : ''} data-reduced-motion={reducedMotion} aria-label="Office scene">
    <div ref={viewport} className="office-map-viewport" data-testid="office-map-viewport" tabIndex={0} role="region" aria-label="Shared office map. Scroll to explore the office." onScroll={() => { setHover(null); refreshSelectedAnchor(); }}>
      <div className="office-map-extent" style={{ width: worldWidth * cameraScale, height: worldHeight * cameraScale }}>
      <div className="office-map-surface" data-testid="office-map-surface" style={{ width: worldWidth, height: worldHeight, transform: `scale(${cameraScale})` }}>
        <img className="office-background office-map-artwork" src={officeBackground} style={{ width: artworkCanvas.width, height: artworkCanvas.height }} onLoad={event => setArtworkAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} alt="One open-plan office with desk areas, a central gathering rug, reading corners and sofas" />
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
          return <button key={agent.agentId} className={`scene-agent ${selectedAgentId === agent.agentId ? 'is-selected' : ''}`} data-testid={`scene-agent-${agent.agentId}`} data-project-id={agent.projectId} data-meeting-participant={participantIndex !== -1} data-location={location} data-motion={motion} data-lifecycle-phase={lifecyclePhase} data-animation={animationName ?? ''} data-runtime-state={agent.runtimeState} data-home-left={`${home.x}px`} data-home-top={`${home.y}px`} aria-label={`Inspect ${agent.displayName}`} aria-pressed={selectedAgentId === agent.agentId} style={style}
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
    </div>
    {hoveredAgent && hover && snapshot && <PetHint agent={hoveredAgent} anchor={hover.anchor} statusLabel={observedStatusLabel(hoveredAgent, snapshot)} />}
  </div>;
}
