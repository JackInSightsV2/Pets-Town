import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HandoffStore } from '../client/handoffs';
import { officeGeometry } from '../office/environment';
import { OfficeScene } from './OfficeScene';
import { ThreeOfficeScene } from './ThreeOfficeScene';
import { PetDetails } from './PetDetails';
import { connectionView, hasFixtureData, nativeAssetFor } from './view-model';
import './styles.css';
import './canvas.css';

type PresentationAction = 'start' | 'skip' | 'reset';
interface AppProps { store: HandoffStore; onPresentationAction(action: PresentationAction, isCurrent?: () => boolean): Promise<void> }

export function App({ store, onPresentationAction }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const meetings = useSyncExternalStore(store.subscribeMeetings, store.getMeetingState, store.getMeetingState);
  const { snapshot, selectedAgentId } = state;
  const [use3D, setUse3D] = useState(() => new URLSearchParams(window.location.search).get('view') !== '2d');
  const Scene = use3D ? ThreeOfficeScene : OfficeScene;
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const startupAttempts = useRef<{ session: string; count: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selectedAgent = snapshot?.agents.find(agent => agent.agentId === selectedAgentId && agent.runtimeState !== 'closed') ?? null;
  const visibleAgents = snapshot?.agents.filter(agent => agent.runtimeState !== 'closed') ?? [];
  const visiblePetIds = JSON.stringify(visibleAgents.filter(agent => snapshot && nativeAssetFor(agent, snapshot.petAssets)).map(agent => agent.agentId));
  useEffect(() => { store.setVisibleAgents(JSON.parse(visiblePetIds) as string[]); }, [store, visiblePetIds]);

  // Enter only the office presentation. These actions never start or resume agent work.
  useEffect(() => {
    if (!snapshot?.controlToken || state.transport.status !== 'connected') return;
    const session = `${snapshot.bridgeEpoch}:${snapshot.officeSessionId}`;
    if (startupAttempts.current?.session !== session) startupAttempts.current = { session, count: 0 };
    const attempts = startupAttempts.current;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () => {
      const current = store.getState();
      return active && mounted.current && current.transport.status === 'connected' && !!current.snapshot
        && `${current.snapshot.bridgeEpoch}:${current.snapshot.officeSessionId}` === session;
    };
    const enterLive = async () => {
      retry = null;
      if (!isCurrent() || store.getState().snapshot?.presentation.state === 'live' || attempts.count >= 3) return;
      attempts.count++;
      try {
        if (store.getState().snapshot?.presentation.state === 'ready') await onPresentationAction('start', isCurrent);
        if (isCurrent() && store.getState().snapshot?.presentation.state !== 'live') await onPresentationAction('skip', isCurrent);
      } catch {
        if (isCurrent() && attempts.count < 3) retry = setTimeout(() => { void enterLive(); }, 500);
      }
    };
    void enterLive();
    return () => { active = false; if (retry !== null) clearTimeout(retry); };
  }, [snapshot?.bridgeEpoch, snapshot?.officeSessionId, snapshot?.controlToken, state.transport.status, onPresentationAction, store]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') store.selectAgent(null); };
    const select = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (detail && typeof detail === 'object' && 'agentId' in detail && typeof detail.agentId === 'string') {
        const button = document.querySelector<HTMLElement>(`[data-testid="scene-agent-${CSS.escape(detail.agentId)}"]`);
        const rect = button?.getBoundingClientRect();
        setAnchor(rect ? { x: rect.left + rect.width / 2, y: rect.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
        store.selectAgent(detail.agentId);
      }
    };
    window.addEventListener('keydown', dismiss);
    window.addEventListener('petstown:select-agent', select);
    return () => { window.removeEventListener('keydown', dismiss); window.removeEventListener('petstown:select-agent', select); };
  }, [store]);

  // Live placement is immediate while the presentation-only request reaches the bridge.
  const sceneSnapshot = snapshot && snapshot.presentation.state !== 'live'
    ? { ...snapshot, presentation: { state: 'live' as const, canSkip: false } } : snapshot;
  return <main className="office-canvas" data-testid="office-app" onPointerDown={event => {
    if (!(event.target instanceof Element) || !event.target.closest('.scene-agent, .pet-details')) store.selectAgent(null);
  }}>
    {!use3D && <button className="view-switch-3d" onClick={() => setUse3D(true)}>3D venue</button>}
    <Scene onClearSelection={() => store.selectAgent(null)} onUse2D={() => setUse3D(false)} connectionLabel={connectionView(state).label} connectionStale={connectionView(state).stale} observerConnected={state.transport.status === 'connected'} geometry={officeGeometry} snapshot={sceneSnapshot} selectedAgentId={selectedAgentId} visibleAgents={visibleAgents}
      onSelectAgent={(agentId, point) => { if (point) setAnchor(point); store.selectAgent(agentId); }}
      meeting={meetings.active} onMeetingComplete={store.completeMeeting} />
    {hasFixtureData(snapshot) && <span className="canvas-fixture-label" data-testid="fixture-banner">Fixture data</span>}
    {selectedAgent && snapshot && <PetDetails agent={selectedAgent} snapshot={snapshot} anchor={anchor} stale={connectionView(state).stale} onClose={() => store.selectAgent(null)} />}
  </main>;
}
