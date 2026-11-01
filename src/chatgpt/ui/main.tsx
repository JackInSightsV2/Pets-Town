import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { officeGeometry } from '../../office/environment';
import { createRoot } from 'react-dom/client';
import { OfficeBehaviorProvider } from '../../ui/useOfficeBehavior';
import { OfficeScene } from '../../ui/OfficeScene';
import { ThreeOfficeScene } from '../../ui/ThreeOfficeScene';
import { NativePet } from '../../ui/NativePet';
import { nativeAssetFor, stateLabels, attentionFor, timeLabel } from '../../ui/view-model';
import { createEmbeddedController, type EmbeddedController } from './controller';
import '../../ui/styles.css';
import './embedded.css';

function EmbeddedOffice({ controller }: { controller: EmbeddedController }) {
  const [use3D, setUse3D] = useState(true);
  const Scene = use3D ? ThreeOfficeScene : OfficeScene;
  const sceneContainer = useRef<HTMLDivElement>(null);
  const [sceneScale, setSceneScale] = useState(1);
  useLayoutEffect(() => {
    const element = sceneContainer.current;
    if (!element) return;
    const resize = () => setSceneScale(Math.min(1, element.clientWidth / officeGeometry.canvas!.width));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const host = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const { store } = controller;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const meetings = useSyncExternalStore(store.subscribeMeetings, store.getMeetingState, store.getMeetingState);
  const snapshot = state.snapshot;
  const agents = snapshot?.agents.filter(agent => agent.runtimeState !== 'closed') ?? [];
  const selected = agents.find(agent => agent.agentId === state.selectedAgentId);
  const visibleIds = JSON.stringify(agents.map(agent => agent.agentId));
  useEffect(() => { store.setVisibleAgents(JSON.parse(visibleIds) as string[]); }, [store, visibleIds]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') store.selectAgent(null); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [store]);
  const stale = state.transport.status !== 'connected' || snapshot?.connection.status !== 'connected';
  const sceneSnapshot = snapshot ? { ...snapshot, presentation: { state: 'live' as const, canSkip: false } } : null;
  const requests = selected && snapshot ? attentionFor(selected, snapshot) : null;
  return <main className={`embedded-office mode-${host.mode}`} data-testid="embedded-office">
    <header className="embedded-toolbar">
      <div><h1>Your team</h1><span className="embedded-status" data-testid="office-status">{snapshot
        ? snapshot.source === 'fixture' ? 'Synthetic preview' : stale ? 'Last observed' : 'Live observation'
        : 'PetsTown'}</span></div>
      <nav aria-label="Office view">
        {host.modes.includes('fullscreen') && host.mode !== 'fullscreen' && <button onClick={() => void controller.requestMode('fullscreen')}>Expand</button>}
        {host.modes.includes('pip') && host.mode !== 'pip' && <button onClick={() => void controller.requestMode('pip')}>Keep visible</button>}
        {host.mode !== 'inline' && host.modes.includes('inline') && <button onClick={() => void controller.requestMode('inline')}>Back to chat</button>}
        {host.ready && <button onClick={() => void controller.refresh()} disabled={host.refreshing} aria-label="Refresh office">{host.refreshing ? 'Refreshing…' : 'Refresh'}</button>}
      </nav>
    </header>
    {host.message && <p className="embedded-notice" role="status">{host.message}</p>}
    {snapshot && stale && <p className="embedded-notice" role="status">{snapshot.connection.message ?? 'Live observation is unavailable. These details may have changed.'}</p>}
    <div ref={sceneContainer} className="embedded-scene" style={{ '--scene-scale': sceneScale, '--scene-height': `${officeGeometry.canvas!.height * sceneScale}px` } as CSSProperties}>
      {!use3D && <button className="view-switch-3d" onClick={() => setUse3D(true)}>3D venue</button>}
      {snapshot && <Scene embedded celebrationId={host.celebrationId} onClearSelection={() => store.selectAgent(null)} onUse2D={() => setUse3D(false)} geometry={officeGeometry} autoFrame={false} observerConnected={!stale} snapshot={sceneSnapshot} selectedAgentId={state.selectedAgentId}
      visibleAgents={agents} onSelectAgent={store.selectAgent} meeting={meetings.active} onMeetingComplete={store.completeMeeting} />}</div>
    {snapshot && agents.length === 0 && <p className="embedded-empty">{stale ? 'No agents are available from the current source.' : 'No active agents in this project scope.'}</p>}
    {agents.length > 0 && snapshot && <div className="embedded-roster" aria-label="Agents">
      {agents.map(agent => {
        const asset = nativeAssetFor(agent, snapshot.petAssets);
        return <button key={agent.agentId} type="button" aria-pressed={agent.agentId === state.selectedAgentId}
          data-testid={`embedded-agent-${agent.agentId}`} onClick={() => store.selectAgent(agent.agentId)}>
          {asset && <span aria-hidden="true"><NativePet asset={asset} state={agent.runtimeState} size={25} /></span>}
          <span><strong>{agent.displayName}</strong><small>{stateLabels[agent.runtimeState]}</small></span>
          {attentionFor(agent, snapshot).count > 0 && <span className="embedded-attention" aria-label="Needs attention">!</span>}
        </button>;
      })}
    </div>}
    {selected && snapshot && <section className="embedded-details" aria-label={`About ${selected.displayName}`} data-testid="embedded-details">
      <div className="embedded-detail-heading"><div><h2>{selected.displayName}</h2><p>{stateLabels[selected.runtimeState]}{stale ? ' · Last observed' : ''}</p></div>
        <button aria-label="Close pet details" onClick={() => store.selectAgent(null)}>×</button></div>
      <p>{selected.task || 'The current task is not available from this observer.'}</p>
      {selected.recentActivity.slice(0, 3).map(activity => <p className="embedded-activity" key={activity.activityId}>{activity.summary}</p>)}
      {requests?.requests.map(request => <div className="embedded-request" key={request.requestId}>
        <strong>{request.kind === 'approval' ? 'Approval requested' : 'Input requested'}</strong><p>{request.prompt ?? 'Request details unavailable.'}</p>
      </div>)}
      {requests && requests.missingCount > 0 && <p>There is an outstanding request, but its details are unavailable.</p>}
      <div className="embedded-detail-footer"><small>Observed {timeLabel(selected.lastObservedAt)}</small>
        {host.canAsk && <button onClick={() => void controller.askAboutSelected()}>Ask about this pet</button>}</div>
      <p className="embedded-readonly">Read-only · Reply to requests in the original Codex conversation.</p>
    </section>}
    {host.contextMessage && <p className="embedded-notice" role="status">{host.contextMessage}</p>}
    {!host.modes.includes('fullscreen') && !host.modes.includes('pip') && host.ready && <p className="embedded-mode-note">This host supports the inline office view.</p>}
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('PetsTown requires a root element.');
const controller = createEmbeddedController();
createRoot(root).render(<OfficeBehaviorProvider value={{ lifecycle: controller.lifecycle, handoffs: controller.store }}><EmbeddedOffice controller={controller} /></OfficeBehaviorProvider>);
void controller.connect();
window.addEventListener('pagehide', () => controller.stop(), { once: true });
