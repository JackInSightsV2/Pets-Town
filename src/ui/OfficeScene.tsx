import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import type { Meeting, MeetingToken } from '../office/handoffs/meeting-queue';
import { createOfficeLayout, DEFAULT_OFFICE_GEOMETRY, type OfficeGeometry, type Point } from '../office/layout';
import officeBackground from '../../assets/office/office-v1.png';
import { attentionFor, nativeAssetFor } from './view-model';
import { NativePet } from './NativePet';
import './handoffs.css';
import './layout.css';
import './movement.css';

export interface OfficeSceneProps {
  snapshot: OfficeSnapshot | null;
  selectedAgentId: string | null;
  visibleAgents: OfficeAgent[];
  onSelectAgent(agentId: string): void;
  meeting?: Meeting | null;
  onMeetingComplete?(token: MeetingToken): void;
  hiddenHandoffCount?: number;
  geometry?: Partial<OfficeGeometry>;
}

type MeetingPhase = 'approaching' | 'exchanging' | 'returning' | 'complete';
const WALK_MS = 1100;
const EXCHANGE_MS = 4000;
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
export function OfficeScene({ snapshot, selectedAgentId, visibleAgents, onSelectAgent, meeting = null, onMeetingComplete, hiddenHandoffCount = 0, geometry }: OfficeSceneProps) {
  const geometryKey = JSON.stringify(geometry ?? {});
  const allocator = useRef<{ key: string; mapper: ReturnType<typeof createOfficeLayout> } | null>(null);
  if (!allocator.current || allocator.current.key !== geometryKey) allocator.current = { key: geometryKey, mapper: createOfficeLayout(geometry) };
  // Map source membership, never the visibility-filtered view. Hidden identities
  // retain their homes while joins receive fresh slots from the shared mapper.
  const layout = allocator.current.mapper.map(snapshot ?? { agents: [], projects: [] });
  const sceneGeometry = { ...DEFAULT_OFFICE_GEOMETRY, ...geometry };
  const artworkCanvas = geometry?.canvas ?? DEFAULT_OFFICE_GEOMETRY.canvas;
  const nativeAgents = snapshot ? visibleAgents.filter(agent => agent.runtimeState !== 'closed' && nativeAssetFor(agent, snapshot.petAssets)) : [];
  const state = snapshot?.presentation.state ?? 'ready';
  const sessionId = snapshot?.officeSessionId ?? '';
  const viewport = useRef<HTMLDivElement>(null);
  const formation = useRef<{ key: string; slots: Map<string, number> }>({ key: geometryKey, slots: new Map() });
  if (formation.current.key !== geometryKey) formation.current = { key: geometryKey, slots: new Map() };
  for (const id of [...layout.homes.keys()].sort()) if (!formation.current.slots.has(id)) formation.current.slots.set(id, formation.current.slots.size);
  const entrances = new Map<string, Point>();
  const standups = new Map<string, Point>();
  const rests = new Map<string, Point>();
  const homes = [...layout.homes.values()];
  let restIndex = 0;
  for (const [id, index] of formation.current.slots) {
    entrances.set(id, spreadPoint(index, layout.entrance, sceneGeometry, true));
    standups.set(id, spreadPoint(index, layout.standup, sceneGeometry));
    let rest: Point;
    do { rest = spreadPoint(restIndex++, layout.rest, sceneGeometry); }
    while (homes.some(home => Math.abs(home.x - rest.x) < sceneGeometry.spacing.x && Math.abs(home.y - rest.y) < sceneGeometry.spacing.y));
    rests.set(id, rest);
  }
  const hasPets = nativeAgents.length > 0;
  useLayoutEffect(() => {
    if (!hasPets || !viewport.current) return;
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
      const points = nativeAgents.map(agent => agent.runtimeState === 'idle' ? rests.get(agent.agentId)! : layout.homes.get(agent.agentId)!);
      const top = Math.min(...points.map(point => point.y)) - 100;
      const bottom = Math.max(...points.map(point => point.y)) + 100;
      view.scrollTop = bottom - top <= view.clientHeight ? Math.max(0, (top + bottom - view.clientHeight) / 2) : 0;
    }
  }, [state, sessionId, hasPets, geometryKey]);
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
  const cooler = layout.waterCooler;
  const placed = nativeAgents.map(agent => {
    const home = layout.homes.get(agent.agentId)!;
    const entrance = entrances.get(agent.agentId)!;
    const standup = standups.get(agent.agentId)!;
    const participantIndex = activeMeeting ? pair.indexOf(agent.agentId) : -1;
    let location = state === 'ready' ? 'entrance' : state === 'arrivals' || state === 'standup' ? 'standup' : agent.runtimeState === 'idle' ? 'rest' : 'home';
    let point = location === 'entrance' ? entrance : location === 'standup' ? standup : location === 'rest' ? rests.get(agent.agentId)! : home;
    if (participantIndex !== -1) {
      location = atCooler ? 'water-cooler' : 'home';
      point = atCooler ? cooler[participantIndex] : home;
    }
    const animationName = agent.runtimeState === 'error' || participantIndex !== -1 ? undefined : state === 'ready' ? 'idle' : state === 'standup' ? 'waving' : state === 'arrivals' ? reducedMotion ? 'idle' : standup.x < entrance.x ? 'running-left' : 'running-right' : undefined;
    return { agent, home, entrance, standup, participantIndex, location, point, animationName };
  });
  const worldWidth = Math.max(layout.width, ...placed.map(pet => pet.point.x + 60));
  const worldHeight = Math.max(layout.height, ...placed.map(pet => pet.point.y + 60));
  return <div className="office-scene mapped-office" data-testid="office-scene" data-presentation={state} data-meeting={activeMeeting?.handoff.handoffId ?? ''} data-meeting-phase={phase} data-reduced-motion={reducedMotion} aria-label="Office scene">
    <div ref={viewport} className="office-map-viewport" data-testid="office-map-viewport" tabIndex={0} role="region" aria-label="Shared office map. Scroll to explore the office.">
      <div className="office-map-surface" data-testid="office-map-surface" style={{ width: worldWidth, height: worldHeight }}>
        <img className="office-background office-map-artwork" src={officeBackground} style={{ width: artworkCanvas.width, height: artworkCanvas.height }} alt="One open-plan office with desk areas, a central gathering rug, reading corners and sofas" />
        <div className="scene-grain" />
        {activeMeeting && <div className="handoff-meeting" data-testid="handoff-meeting" data-handoff-id={activeMeeting.handoff.handoffId} data-phase={phase} style={{ left: (cooler[0].x + cooler[1].x) / 2, top: Math.max(48, Math.min(cooler[0].y, cooler[1].y) - 168) }}>
          <span className="handoff-location">WATER COOLER</span>
          {phase === 'exchanging' && <div className="handoff-bubble" role="status"><span className="handoff-participants">{from?.displayName} <span aria-hidden="true">→</span> {to?.displayName}</span><p data-testid="handoff-summary">{activeMeeting.handoff.summary || 'Handoff observed; summary unavailable from this source.'}</p></div>}
        </div>}
        {placed.map(({ agent, home, entrance, standup, participantIndex, location, point, animationName }) => {
          const asset = nativeAssetFor(agent, snapshot!.petAssets)!;
          const style = { left: point.x, top: point.y, '--entrance-x': `${entrance.x}px`, '--entrance-y': `${entrance.y}px`, '--standup-x': `${standup.x}px`, '--standup-y': `${standup.y}px`, '--arrival-delay': `${Math.min(formation.current.slots.get(agent.agentId)! * 70, 560)}ms` } as CSSProperties;
          return <button key={agent.agentId} className={`scene-agent ${selectedAgentId === agent.agentId ? 'is-selected' : ''}`} data-testid={`scene-agent-${agent.agentId}`} data-project-id={agent.projectId} data-meeting-participant={participantIndex !== -1} data-location={location} data-motion={state === 'arrivals' ? 'arriving' : 'settled'} data-runtime-state={agent.runtimeState} data-home-left={`${home.x}px`} data-home-top={`${home.y}px`} aria-label={`Inspect ${agent.displayName}`} aria-pressed={selectedAgentId === agent.agentId} style={style} onClick={() => onSelectAgent(agent.agentId)}>
            {attentionFor(agent, snapshot!).count > 0 && <span className="scene-attention" aria-label="Unresolved request">!</span>}
            {agent.runtimeState === 'error' && <span className="scene-runtime-error" aria-label="Agent error">×</span>}
            <NativePet asset={asset} state={agent.runtimeState} animationName={animationName} />
            <span className="scene-agent-label">{agent.displayName}</span>
          </button>;
        })}
      </div>
    </div>
    <div className="scene-floor-tag"><span /> THE SHARED OFFICE <span className="floor-separator">/</span> FLOOR 01</div>
    {hiddenHandoffCount > 0 && <div className="hidden-handoff-count" data-testid="hidden-handoff-count" role="status">{hiddenHandoffCount} {hiddenHandoffCount === 1 ? 'handoff involves' : 'handoffs involve'} hidden pets</div>}
    {nativeAgents.length === 0 && <div className="scene-empty" data-testid="native-pet-empty-state">
      <span className="eyebrow">THE SPACE IS READY</span>
      <strong>{snapshot?.agents.length ? 'Your agents are in the roster.' : 'A place for your working agents.'}</strong>
      <p>{snapshot?.agents.length ? visibleAgents.length ? 'Native pet artwork is not available for these agents yet. Select an agent below to inspect its observed activity.' : 'The current visibility settings hide these pets. Their work continues in Codex.' : 'Connected Codex agents will appear here when a supported source is available.'}</p>
    </div>}
    <div className="scene-caption"><span className="scene-caption-dot" /> {nativeAgents.length ? 'Pet assets: ChatGPT / Codex' : 'Office environment · native pets only'}<span>Scroll to explore the office</span></div>
  </div>;
}
