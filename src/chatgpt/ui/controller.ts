import { App as HostApp, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { createHandoffStore } from '../../client/handoffs';
import { createLifecycleStore } from '../../client/lifecycle';
import { isOfficeSnapshot, isOfficeEvent } from '../../client/validation';
import { OFFICE_TOOLS, type OfficeView } from '../types';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function readOfficeView(result: unknown): OfficeView | null {
  if (!record(result) || result.isError || !record(result._meta) || !record(result._meta.office)) return null;
  const view = result._meta.office;
  if (typeof view.scopeId !== 'string' || !view.scopeId || !isOfficeSnapshot(view.snapshot) || view.snapshot.controlToken !== undefined
    || !(view.selectedAgentId === null || typeof view.selectedAgentId === 'string') || !(view.projectId === null || typeof view.projectId === 'string')) return null;
  return { snapshot: view.snapshot, scopeId: view.scopeId, selectedAgentId: view.selectedAgentId, projectId: view.projectId };
}
export function createEmbeddedController(app = new HostApp({ name: 'PetsTown', version: '0.1.3' })) {
  const lifecycle = createLifecycleStore();
  const store = createHandoffStore({ store: lifecycle, getEligibleAgentIds: () => lifecycle.getLifecycleState().sprites
    .filter(sprite => !sprite.attention && (sprite.phase === 'unknown' || sprite.meetingEligible)).map(sprite => sprite.agentId) });
  let view: OfficeView | null = null, stopped = false, ready = false, refreshing = false, generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() { clearTimeout(timer); if (!stopped && ready && view && !document.hidden) timer = setTimeout(() => void refresh(), 1000); }
  function baseline(result: unknown, allowScopeChange = false) {
    const next = readOfficeView(result);
    if (!next || (!allowScopeChange && view && next.scopeId !== view.scopeId)) return false;
    const selected = view?.scopeId === next.scopeId ? store.getState().selectedAgentId : next.selectedAgentId;
    view = next; store.applySnapshot(next.snapshot);
    if (store.getState().error) return false;
    store.selectAgent(next.snapshot.agents.some(agent => agent.agentId === selected && agent.runtimeState !== 'closed') ? selected : null); store.setTransportStatus('connected'); return true;
  }
  function apply(result: unknown) {
    if (!record(result) || !record(result._meta) || !record(result._meta.office)) return false;
    const office = result._meta.office;
    const refresh = office.refresh;
    if (record(refresh) && refresh.mode === 'events') {
      if (store.getState().transport.status !== 'connected') return baseline(result);
      const current = store.getState().snapshot;
      const next = readOfficeView(result);
      if (!view || !current || !next || next.scopeId !== view.scopeId || !Array.isArray(refresh.events)
        || !refresh.events.every(isOfficeEvent) || next.snapshot.bridgeEpoch !== current.bridgeEpoch
        || next.snapshot.source !== current.source || next.snapshot.officeSessionId !== current.officeSessionId) return false;
      if (current.connection.status !== 'connected' && next.snapshot.connection.status === 'connected') return baseline(result);
      let seq = current.lastSeq;
      for (const event of refresh.events) if (event.bridgeEpoch !== current.bridgeEpoch || event.seq !== ++seq || (event.source !== current.source && event.source !== 'office')) return false;
      if (seq !== next.snapshot.lastSeq) return false;
      for (const event of refresh.events) store.applyEvent(event);
      if (store.getState().error) return false;
      store.setTransportStatus('connected'); return true;
    }
    return baseline(result);
  }
  async function refresh() {
    if (stopped || !ready || !view || refreshing || document.hidden) return;
    if (!app.getHostCapabilities()?.serverTools) { store.setTransportStatus('disconnected'); return; }
    refreshing = true;
    const atStart = generation;
    try {
      const snapshot = store.getState().snapshot;
      const result = await app.callServerTool({ name: OFFICE_TOOLS.refresh, arguments: { scopeId: view.scopeId,
        ...(view.projectId ? { projectId: view.projectId } : {}),
        ...(snapshot && store.getState().transport.status === 'connected' ? { cursor: { bridgeEpoch: snapshot.bridgeEpoch, lastSeq: snapshot.lastSeq, source: snapshot.source } } : {}) } }, { timeout: 8000 });
      if (!stopped && generation === atStart && !apply(result)) store.setTransportStatus('reconnecting');
    } catch { if (!stopped && generation === atStart) store.setTransportStatus('reconnecting'); }
    finally { refreshing = false; schedule(); }
  }
  app.ontoolresult = result => { if (!stopped) { generation++; if (!baseline(result, true)) store.setTransportStatus('disconnected'); schedule(); } };
  app.onhostcontextchanged = ctx => { if (ctx.theme) applyDocumentTheme(ctx.theme); if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables); };
  app.onerror = () => { if (!stopped) store.setTransportStatus('disconnected'); };
  const visibility = () => { clearTimeout(timer); if (document.hidden) { generation++; store.setTransportStatus('reconnecting'); } else void refresh(); };
  async function connect() {
    if (window.parent === window) { store.setTransportStatus('disconnected'); return; }
    document.addEventListener('visibilitychange', visibility);
    try { await app.connect(undefined, { timeout: 8000 }); if (!stopped) { ready = true; schedule(); } }
    catch { if (!stopped) store.setTransportStatus('disconnected'); }
  }
  function stop(close = true) { if (stopped) return; stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); if (close) void app.close(); }
  app.onteardown = () => { stop(false); return {}; };
  return { store, lifecycle, connect, stop, refresh };
}
export type EmbeddedController = ReturnType<typeof createEmbeddedController>;
