import { randomUUID } from 'node:crypto';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import type { VerifiedHistoryReader } from '../handoffs/history-adapter.js';
import { ActivityNormalizer } from './normalizer.js';

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const eligible = (state: OfficeSnapshot, id: string) => state.agents.some(a => a.agentId === id && !['unknown', 'closed', 'error'].includes(a.runtimeState));

/** Read-only history composition. Raw history is never retained or logged. */
export async function createActivityHistoryAdapter(options: {
  base: OfficeAdapter; reader: VerifiedHistoryReader; sourceNamespace: string; pollMs?: number; now?: () => string;
}): Promise<OfficeAdapter> {
  const pollMs = options.pollMs ?? 2000;
  if (!Number.isFinite(pollMs) || pollMs < 10 || !options.sourceNamespace.trim() || options.sourceNamespace.trim() !== options.sourceNamespace) throw new Error('Invalid activity reader options.');
  const now = options.now ?? (() => new Date().toISOString());
  const normalizer = new ActivityNormalizer();
  const listeners = new Set<(event: OfficeEvent) => void>();
  const queued: OfficeEvent[] = [];
  const baselined = new Set<string>();
  const epoch = 'activity-' + randomUUID();
  let state: OfficeSnapshot | undefined;
  let baseEpoch = '', baseSeq = 0, generation = options.reader.generation;
  let stopped = false, failed = false, sourceFailed = false, timer: ReturnType<typeof setTimeout> | undefined;

  function publish(event: OfficeEvent) {
    if (!state || stopped) return;
    event = structuredClone(event);
    event.bridgeEpoch = epoch; event.seq = ++state.lastSeq;
    switch (event.type) {
      case 'project.upserted': state.projects = [...state.projects.filter(p => p.projectId !== event.data.project.projectId), event.data.project]; break;
      case 'agent.upserted': {
        const previous = state.agents.find(a => a.agentId === event.data.agent.agentId);
        if (previous?.recentActivity.length) event.data.agent = { ...event.data.agent, recentActivity: previous.recentActivity, activityKind: previous.activityKind };
        state.agents = [...state.agents.filter(a => a.agentId !== event.data.agent.agentId), event.data.agent]; break;
      }
      case 'agent.activity': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, activityKind: event.data.activity.kind, lastObservedAt: event.occurredAt, recentActivity: [event.data.activity, ...a.recentActivity.filter(x => x.activityId !== event.data.activity.activityId)].slice(0, 50) } : a); break;
      case 'agent.state.changed': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, runtimeState: event.data.runtimeState } : a); break;
      case 'agent.closed': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, runtimeState: 'closed' } : a); break;
      case 'connection.changed':
        if (event.data.connection.status === 'connected') event.data.connection = { ...event.data.connection,
          message: sourceFailed ? 'Command activity reader stopped; reopen Office to retry.' : 'Live metadata and passive command activity observation; request details remain unavailable.' };
        state.connection = event.data.connection; break;
      case 'capabilities.changed': state.capabilities = event.data.capabilities; break;
      case 'request.opened': state.pendingRequests = [...state.pendingRequests.filter(r => r.requestId !== event.data.request.requestId), event.data.request]; break;
      case 'request.resolved': state.pendingRequests = state.pendingRequests.filter(r => r.requestId !== event.data.requestId || (event.agentId !== null && r.agentId !== event.agentId)); break;
      case 'handoff.observed': state.recentHandoffs = [event.data.handoff, ...state.recentHandoffs.filter(h => h.handoffId !== event.data.handoff.handoffId)].slice(0, 50); break;
      case 'presentation.changed': state.presentation = { state: event.data.state, canSkip: event.data.canSkip }; state.officeSessionId = event.data.officeSessionId; break;
      case 'agent.work.completed': break;
    }
    for (const listener of [...listeners]) try { listener(structuredClone(event)); } catch { /* Isolate consumers. */ }
  }
  function fromBase(event: OfficeEvent) {
    if (stopped || failed) return;
    if (!state) { queued.push(structuredClone(event)); return; }
    if (event.bridgeEpoch === baseEpoch && event.seq <= baseSeq) return;
    if (event.bridgeEpoch !== baseEpoch || event.seq !== baseSeq + 1) {
      failed = true;
      publish({ protocolVersion: 1, bridgeEpoch: epoch, seq: 0, eventId: randomUUID(), occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null, data: { connection: { ...state.connection, status: 'disconnected', message: 'Observer event continuity lost; reopen Office.' } } });
      return;
    }
    baseSeq = event.seq;
    publish(event);
    if (event.type === 'connection.changed' && event.data.connection.status !== 'connected') baselined.clear();
  }
  const unsubscribe = options.base.subscribe(fromBase);
  async function scan() {
    if (!state || stopped || failed || sourceFailed || state.connection.status !== 'connected') return;
    if (!options.reader.generation) throw new Error('Missing reader generation.');
    if (generation !== options.reader.generation) { generation = options.reader.generation; baselined.clear(); }
    for (const threadId of state.agents.filter(a => eligible(state!, a.agentId)).map(a => a.agentId)) {
      const response = await options.reader.read(threadId);
      if (stopped || failed || !state || state.connection.status !== 'connected') return;
      if (generation !== options.reader.generation) { generation = options.reader.generation; baselined.clear(); return; }
      if (!object(response) || !object(response.thread) || response.thread.id !== threadId || !Array.isArray(response.thread.turns)) throw new Error('Invalid activity history.');
      const history = !baselined.has(threadId);
      for (const turn of response.thread.turns) {
        if (!object(turn) || typeof turn.id !== 'string' || !Array.isArray(turn.items)) continue;
        for (const item of turn.items) {
          const occurredAt = now();
          const result = normalizer.observe({ source: 'codex', sourceNamespace: options.sourceNamespace, threadId, turnId: turn.id, agentId: threadId, observedAt: occurredAt,
            delivery: history || !eligible(state, threadId) ? 'history' : 'live', event: { method: 'item/completed', params: { threadId, turnId: turn.id, item } } });
          if (result.kind === 'unavailable' && (result.reason === 'capacity-exceeded' || result.reason === 'conflicting-source')) throw new Error('Activity correlation unavailable.');
          if (result.kind === 'observed') publish({ protocolVersion: 1, bridgeEpoch: epoch, seq: 0, eventId: result.activity.activityId, occurredAt, source: 'codex', type: 'agent.activity', agentId: threadId, data: { activity: result.activity } });
        }
      }
      baselined.add(threadId);
    }
  }
  try {
    const initial = structuredClone(await options.base.initialSnapshot());
    if (initial.source !== 'codex') throw new Error('Activity requires a Codex source.');
    baseEpoch = initial.bridgeEpoch; baseSeq = initial.lastSeq;
    state = { ...initial, bridgeEpoch: epoch, lastSeq: 0 };
    for (const event of queued) fromBase(event);
    queued.length = 0;
    function sourceError() {
      sourceFailed = true;
      if (state && !stopped) publish({ protocolVersion: 1, bridgeEpoch: epoch, seq: 0, eventId: randomUUID(), occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null,
        data: { connection: { ...state.connection, message: 'Command activity reader stopped; reopen Office to retry.' } } });
    }
    try { await scan(); } catch { sourceError(); }
    const tick = async () => { if (stopped || failed || sourceFailed) return; try { await scan(); } catch { sourceError(); } finally { if (!stopped && !failed && !sourceFailed) timer = setTimeout(() => void tick(), pollMs); } };
    if (!failed && !sourceFailed) timer = setTimeout(() => void tick(), pollMs);
    return { initialSnapshot: () => structuredClone(state!), subscribe(listener) { if (!stopped) listeners.add(listener); return () => listeners.delete(listener); },
      async stop() { if (stopped) return; stopped = true; clearTimeout(timer); listeners.clear(); unsubscribe(); await Promise.all([options.base.stop(), options.reader.close()]); } };
  } catch (error) { stopped = true; unsubscribe(); await Promise.all([options.base.stop(), options.reader.close()]); throw error; }
}
