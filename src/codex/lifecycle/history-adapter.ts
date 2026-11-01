import { randomUUID } from 'node:crypto';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import { upsertLatestTurn, type TurnLifecycleObservation } from '../../shared/turn-lifecycle.js';
import type { VerifiedHistoryReader } from '../handoffs/history-adapter.js';
import { normalizeTurnLifecycle } from './normalizer.js';

export interface TurnLifecycleHistoryOptions {
  base: OfficeAdapter;
  /** Owned by this wrapper; use a separate reader if another adapter also owns one. */
  reader: VerifiedHistoryReader;
  sourceNamespace: string;
  /** The caller has verified this runtime's full, oldest-to-newest Turn projection. */
  sourceVerified: boolean;
  pollMs?: number;
  now?: () => string;
}

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Passive, optional lifecycle composition. Every read is correlated to a scoped
 * roster thread and only its final source-ordered Turn can establish latest truth.
 * No transcript/error detail is retained, logged or persisted. Unknown latest
 * turns/read gaps preserve last-known evidence and require a silent new baseline.
 */
export async function createTurnLifecycleHistoryAdapter(options: TurnLifecycleHistoryOptions): Promise<OfficeAdapter> {
  const pollMs = options.pollMs ?? 2000;
  if (!Number.isFinite(pollMs) || pollMs < 10) throw new Error('pollMs must be at least 10ms.');
  if (!options.sourceNamespace.trim() || options.sourceNamespace.trim() !== options.sourceNamespace) {
    throw new Error('A stable source namespace is required.');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const wrapEpoch = 'turn-history-' + randomUUID();
  const listeners = new Set<(event: OfficeEvent) => void>();
  const queued: OfficeEvent[] = [];
  const baselined = new Set<string>();
  let state: OfficeSnapshot | undefined;
  let baseEpoch = '', baseSeq = 0;
  let readerGeneration = options.reader.generation;
  let stopped = false, baseFailed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function publish(input: OfficeEvent) {
    if (!state || stopped) return;
    const event = structuredClone(input);
    event.bridgeEpoch = wrapEpoch;
    event.seq = ++state.lastSeq;
    const changeAgent = (fn: (agent: OfficeSnapshot['agents'][number]) => OfficeSnapshot['agents'][number]) => {
      state!.agents = state!.agents.map(agent => agent.agentId === event.agentId ? fn(agent) : agent);
    };
    switch (event.type) {
      case 'project.upserted': state.projects = [...state.projects.filter(p => p.projectId !== event.data.project.projectId), event.data.project]; break;
      case 'agent.upserted': {
        const previous = state.agents.find(a => a.agentId === event.data.agent.agentId);
        const agent = { ...event.data.agent, pendingRequestIds: [...new Set([
          ...event.data.agent.pendingRequestIds, ...(previous?.pendingRequestIds ?? []),
          ...state.pendingRequests.filter(r => r.agentId === event.data.agent.agentId).map(r => r.requestId),
        ])] };
        state.agents = [...state.agents.filter(a => a.agentId !== agent.agentId), agent];
        break;
      }
      case 'agent.state.changed': changeAgent(a => ({ ...a, runtimeState: event.data.runtimeState, lastObservedAt: event.occurredAt })); break;
      case 'agent.closed': changeAgent(a => ({ ...a, runtimeState: 'closed', lastObservedAt: event.occurredAt })); break;
      case 'agent.activity': changeAgent(a => ({ ...a, activityKind: event.data.activity.kind, lastObservedAt: event.occurredAt,
        recentActivity: [event.data.activity, ...a.recentActivity.filter(x => x.activityId !== event.data.activity.activityId)].slice(0, 50) })); break;
      case 'agent.turn.observed': state.latestTurns = upsertLatestTurn(state.latestTurns, event.data.observation); break;
      case 'request.opened': {
        const request = event.data.request;
        state.pendingRequests = [...state.pendingRequests.filter(r => r.requestId !== request.requestId), request];
        state.agents = state.agents.map(a => a.agentId === request.agentId
          ? { ...a, pendingRequestIds: [...new Set([...a.pendingRequestIds, request.requestId])] } : a);
        break;
      }
      case 'request.resolved': {
        const owners = new Set([...state.pendingRequests.filter(r => r.requestId === event.data.requestId).map(r => r.agentId),
          ...state.agents.filter(a => a.pendingRequestIds.includes(event.data.requestId)).map(a => a.agentId)]);
        if (event.agentId !== null && [...owners].some(id => id !== event.agentId)) break;
        state.pendingRequests = state.pendingRequests.filter(r => r.requestId !== event.data.requestId);
        state.agents = state.agents.map(a => ({ ...a, pendingRequestIds: a.pendingRequestIds.filter(id => id !== event.data.requestId) }));
        break;
      }
      case 'handoff.observed': state.recentHandoffs = [event.data.handoff, ...state.recentHandoffs.filter(h => h.handoffId !== event.data.handoff.handoffId)].slice(0, 50); break;
      case 'capabilities.changed': state.capabilities = event.data.capabilities; break;
      case 'connection.changed': state.connection = event.data.connection; break;
      case 'presentation.changed': state.presentation = { state: event.data.state, canSkip: event.data.canSkip }; state.officeSessionId = event.data.officeSessionId; break;
      case 'agent.work.completed': break;
    }
    for (const listener of [...listeners]) try { listener(structuredClone(event)); } catch { /* A viewer cannot stop observation. */ }
  }

  function fromBase(event: OfficeEvent) {
    if (stopped || baseFailed) return;
    if (!state) { queued.push(structuredClone(event)); return; }
    if (event.bridgeEpoch === baseEpoch && event.seq <= baseSeq) return;
    if (event.bridgeEpoch !== baseEpoch || event.seq !== baseSeq + 1) {
      baseFailed = true;
      baselined.clear();
      publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
        occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null,
        data: { connection: { ...state.connection, status: 'disconnected',
          message: 'Metadata observer lost event continuity; reopen Office to reconnect.' } } });
      return;
    }
    baseSeq = event.seq;
    if (event.type === 'connection.changed' && event.data.connection.status !== 'connected') baselined.clear();
    publish(event);
  }

  function observe(observation: TurnLifecycleObservation, initial: boolean) {
    if (!state) return;
    const previous = state.latestTurns?.find(row => row.agentId === observation.agentId);
    // A whole short turn may finish between polls. Reconcile its outcome without
    // replaying an exit/death for work this observer never saw start.
    if (observation.status !== 'started' && previous?.turnId !== observation.turnId) {
      observation = { ...observation, delivery: 'history' };
    }
    const next = upsertLatestTurn(state.latestTurns, observation);
    // Reject stale/conflicting terminal evidence; it must not animate either.
    if (next === state.latestTurns && previous?.sourceEventId !== observation.sourceEventId) return;
    if (initial) { state.latestTurns = next; return; }
    if (previous?.sourceEventId === observation.sourceEventId && observation.delivery === 'live') return;
    publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
      occurredAt: observation.occurredAt, source: 'codex', type: 'agent.turn.observed',
      agentId: observation.agentId, data: { observation } });
  }

  async function scan(initial = false) {
    if (stopped || baseFailed || !state || state.connection.status !== 'connected') return;
    const generation = options.reader.generation;
    if (!generation || generation !== readerGeneration) { readerGeneration = generation; baselined.clear(); }
    if (!generation) return;
    // Metadata unknown/error is not evidence of a turn outcome and cannot exclude it.
    const scopedIds = state.agents.map(agent => agent.agentId);
    for (const id of [...baselined]) if (!scopedIds.includes(id)) baselined.delete(id);
    for (const threadId of scopedIds) {
      if (stopped || baseFailed || state.connection.status !== 'connected') return;
      let response: unknown;
      try { response = await options.reader.read(threadId); }
      catch { baselined.delete(threadId); continue; }
      if (stopped || baseFailed || state.connection.status !== 'connected') return;
      if (generation !== options.reader.generation) {
        readerGeneration = options.reader.generation;
        baselined.clear();
        return;
      }
      if (!state.agents.some(agent => agent.agentId === threadId)) { baselined.delete(threadId); continue; }
      if (!object(response) || !object(response.thread) || response.thread.id !== threadId || !Array.isArray(response.thread.turns)) {
        baselined.delete(threadId); continue;
      }
      const latest = response.thread.turns.at(-1);
      // Empty startup can precede the first turn. Losing already-known history is
      // a gap, so a later recovery must not animate as continuously observed work.
      if (response.thread.turns.length === 0) {
        if (state.latestTurns?.some(row => row.agentId === threadId)) baselined.delete(threadId);
        else baselined.add(threadId);
        continue;
      }
      const result = normalizeTurnLifecycle({ source: 'codex', sourceNamespace: options.sourceNamespace,
        threadId, agentId: threadId, observedAt: now(), delivery: baselined.has(threadId) ? 'live' : 'history',
        format: 'history-turn', value: { threadId, turn: latest },
        currentThreadActive: object(response.thread.status) && response.thread.status.type === 'active' });
      if (result.kind !== 'observed') { baselined.delete(threadId); continue; }
      observe(result.observation, initial);
      baselined.add(threadId);
    }
  }

  const unsubscribe = options.base.subscribe(fromBase);
  async function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    listeners.clear();
    unsubscribe();
    await Promise.all([options.base.stop(), options.reader.close()]);
  }
  try {
    const initial = structuredClone(await options.base.initialSnapshot());
    if (initial.source !== 'codex') throw new Error('Live turn lifecycle composition requires a Codex source.');
    baseEpoch = initial.bridgeEpoch;
    baseSeq = initial.lastSeq;
    state = { ...initial, bridgeEpoch: wrapEpoch, lastSeq: 0 };
    for (const event of queued) fromBase(event);
    queued.length = 0;
    if (options.sourceVerified) {
      try { await scan(true); } catch { baselined.clear(); }
      const tick = async () => {
        try { await scan(); }
        catch { baselined.clear(); /* Optional history cannot break metadata observation. */ }
        finally { if (!stopped && !baseFailed) timer = setTimeout(() => void tick(), pollMs); }
      };
      if (!stopped && !baseFailed) timer = setTimeout(() => void tick(), pollMs);
    }
    return {
      initialSnapshot: () => structuredClone(state!),
      subscribe(listener) { if (!stopped) listeners.add(listener); return () => { listeners.delete(listener); }; },
      stop,
    };
  } catch (error) { await stop(); throw error; }
}
