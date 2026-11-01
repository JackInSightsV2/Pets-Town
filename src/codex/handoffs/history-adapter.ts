import { randomUUID } from 'node:crypto';
import type { OfficeAdapter } from '../../server/adapter.js';
import { unsupported, type OfficeEvent, type OfficeSnapshot } from '../../shared/contract.js';
import { HandoffNormalizer } from './normalizer.js';

/** A separately owned passive reader. It must never create/resume/interrupt agent work. */
export interface VerifiedHistoryReader {
  /** Changes on a disconnect/reconnect, invalidating per-thread baselines. */
  readonly generation: string;
  /** Returns a source thread/read response, including turns. */
  read(threadId: string): Promise<unknown>;
  close(): void | Promise<void>;
}
export interface HistoryAdapterOptions {
  base: OfficeAdapter;
  reader?: VerifiedHistoryReader;
  /** Opens and revalidates an independent read-only source on each retry. */
  connectReader?: () => Promise<VerifiedHistoryReader>;
  /** Stable across viewer reconnects, identifying the verified source runtime. */
  sourceNamespace: string;
  /** True only after this exact runtime/version and history projection have been verified. */
  sourceVerified: boolean;
  pollMs?: number;
  now?: () => string;
}
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const liveAgent = (state: OfficeSnapshot, id: string) => state.agents.some(a =>
  a.agentId === id && a.runtimeState !== 'unknown' && a.runtimeState !== 'closed' && a.runtimeState !== 'error');
const handoffConnectionMessage = 'Live agent metadata and observed message exchanges. Detailed activity and requests are unavailable.';

/**
 * Optional composition seam, not a transport. The caller is responsible for
 * proving that the reader returns successful completed interaction records.
 * A history read may expose private transcripts; never log or persist it.
 */
export async function createHandoffHistoryAdapter(options: HistoryAdapterOptions): Promise<OfficeAdapter> {
  const pollMs = options.pollMs ?? 2000;
  if (!Number.isFinite(pollMs) || pollMs < 10) throw new Error('pollMs must be at least 10ms.');
  if (!options.sourceNamespace.trim() || options.sourceNamespace.trim() !== options.sourceNamespace) throw new Error('A stable source namespace is required.');
  const now = options.now ?? (() => new Date().toISOString());
  const normalizer = new HandoffNormalizer();
  const listeners = new Set<(event: OfficeEvent) => void>();
  const queued: OfficeEvent[] = [];
  const baselined = new Set<string>();
  let state: OfficeSnapshot | undefined;
  let baseEpoch = '', baseSeq = 0;
  let reader = options.reader;
  let generation = reader?.generation ?? '';
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let enabled = false, sourceFailed = false, baseFailed = false;
  let baseConnectionMessage: string | null = null;
  function failHistorySource(reason = 'History reader unavailable; retrying.', retryable = true) {
    if (!state || sourceFailed) return;
    const wasEnabled = enabled;
    enabled = false;
    sourceFailed = !retryable || !options.connectReader;
    baselined.clear();
    const old = reader; reader = undefined; generation = '';
    if (old) void Promise.resolve(old.close()).catch(() => {});
    state.capabilities.observeHandoffs = unsupported(reason);
    if (wasEnabled) {
      publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
        occurredAt: now(), source: 'codex', type: 'capabilities.changed', agentId: null,
        data: { capabilities: structuredClone(state.capabilities) } });
      if (!baseFailed && state.connection.status === 'connected') publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
        occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null,
        data: { connection: { ...state.connection, message: baseConnectionMessage } } });
    }
  }
  const wrapEpoch = 'history-' + randomUUID();

  function publish(input: OfficeEvent) {
    if (!state || stopped) return;
    const event = structuredClone(input);
    event.bridgeEpoch = wrapEpoch;
    event.seq = ++state.lastSeq;
    const data = event.data;
    switch (event.type) {
      case 'project.upserted': state.projects = [...state.projects.filter(p => p.projectId !== event.data.project.projectId), event.data.project]; break;
      case 'agent.upserted': state.agents = [...state.agents.filter(a => a.agentId !== event.data.agent.agentId), event.data.agent]; break;
      case 'agent.state.changed': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, runtimeState: event.data.runtimeState } : a); break;
      case 'agent.closed': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, runtimeState: 'closed' } : a); break;
      case 'agent.activity': state.agents = state.agents.map(a => a.agentId === event.agentId ? { ...a, activityKind: event.data.activity.kind, lastObservedAt: event.occurredAt, recentActivity: [event.data.activity, ...a.recentActivity.filter(x => x.activityId !== event.data.activity.activityId)].slice(0, 50) } : a); break;
      case 'request.opened': state.pendingRequests = [...state.pendingRequests.filter(r => r.requestId !== event.data.request.requestId), event.data.request]; break;
      case 'request.resolved': state.pendingRequests = state.pendingRequests.filter(r => r.requestId !== event.data.requestId || (event.agentId !== null && r.agentId !== event.agentId)); break;
      case 'handoff.observed': state.recentHandoffs = [event.data.handoff, ...state.recentHandoffs.filter(h => h.handoffId !== event.data.handoff.handoffId)].slice(0, 50); break;
      case 'capabilities.changed': state.capabilities = { ...event.data.capabilities, observeHandoffs: state.capabilities.observeHandoffs }; event.data.capabilities = structuredClone(state.capabilities); break;
      case 'connection.changed':
        if (enabled && event.data.connection.status === 'connected') event.data.connection = { ...event.data.connection, message: handoffConnectionMessage };
        state.connection = event.data.connection;
        break;
      case 'presentation.changed': state.presentation = { state: event.data.state, canSkip: event.data.canSkip }; state.officeSessionId = event.data.officeSessionId; break;
      case 'agent.work.completed': break;
    }
    void data;
    for (const listener of [...listeners]) try { listener(structuredClone(event)); } catch { /* one client cannot stop observation */ }
  }
  function fromBase(event: OfficeEvent) {
    if (stopped || baseFailed) return;
    if (!state) { queued.push(structuredClone(event)); return; }
    if (event.bridgeEpoch === baseEpoch && event.seq <= baseSeq) return;
    if (event.bridgeEpoch !== baseEpoch || event.seq !== baseSeq + 1) {
      baseFailed = true;
      failHistorySource('Metadata observer lost event continuity.', false);
      publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
        occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null,
        data: { connection: { ...state.connection, status: 'disconnected',
          message: 'Metadata observer lost event continuity; reopen Office to reconnect.' } } });
      return;
    }
    baseSeq = event.seq;
    if (event.type === 'connection.changed') baseConnectionMessage = event.data.connection.message;
    publish(event);
    if (enabled && event.type === 'connection.changed' && event.data.connection.status !== 'connected') failHistorySource();
  }
  const unsubscribe = options.base.subscribe(fromBase);
  try {
    const initial = structuredClone(await options.base.initialSnapshot());
    if (initial.source !== 'codex') throw new Error('Live handoff composition requires a Codex source.');
    baseEpoch = initial.bridgeEpoch;
    baseSeq = initial.lastSeq;
    baseConnectionMessage = initial.connection.message;
    state = { ...initial, bridgeEpoch: wrapEpoch, lastSeq: 0, capabilities: { ...initial.capabilities,
      observeHandoffs: unsupported('Verified handoff history is not available.') } };
    for (const event of queued) fromBase(event);
    queued.length = 0;
    if (options.sourceVerified) {
      // The first complete read of each thread is always history, including late arrivals.
      async function scan() {
        if (stopped || !state || sourceFailed || state.connection.status !== 'connected') return;
        if (!reader) {
          if (!options.connectReader) { failHistorySource('History reader unavailable.'); return; }
          let connected: VerifiedHistoryReader;
          try { connected = await options.connectReader(); } catch { failHistorySource(); return; }
          if (stopped || sourceFailed || baseFailed || !state || state.connection.status !== 'connected') {
            await connected.close(); return;
          }
          reader = connected; generation = connected.generation; baselined.clear();
        }
        const current = reader;
        if (!current.generation) { failHistorySource(); return; }
        if (generation !== current.generation) {
          generation = current.generation; baselined.clear();
          if (enabled) {
            enabled = false;
            state.capabilities.observeHandoffs = unsupported('Handoff history is being rebaselined.');
            publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
              occurredAt: now(), source: 'codex', type: 'capabilities.changed', agentId: null,
              data: { capabilities: structuredClone(state.capabilities) } });
          }
        }
        const agents = state.agents.filter(a => liveAgent(state!, a.agentId)).map(a => a.agentId);
        for (const threadId of agents) {
          if (stopped || sourceFailed || state.connection.status !== 'connected') return;
          let response: unknown;
          try { response = await current.read(threadId); } catch { if (!stopped && reader === current) failHistorySource(); return; }
          if (stopped || !state || sourceFailed || reader !== current || state.connection.status !== 'connected') return;
          if (!object(response) || !object(response.thread) || response.thread.id !== threadId || !Array.isArray(response.thread.turns)) { failHistorySource(); return; }
          if (generation !== current.generation) { failHistorySource(); return; }
          const history = !baselined.has(threadId);
          for (const turn of response.thread.turns) {
            if (!object(turn) || typeof turn.id !== 'string' || !Array.isArray(turn.items)) continue;
            for (const item of turn.items) {
              if (!object(item) || item.type !== 'subAgentActivity' || item.kind !== 'interacted' || typeof item.agentThreadId !== 'string') continue;
              // If either participant leaves the scoped roster, seed without presenting later.
              const delivery = history || !enabled || !liveAgent(state, threadId) || !liveAgent(state, item.agentThreadId) ? 'history' : 'live';
              const occurredAt = now();
              const result = normalizer.observe({ source: 'codex', sourceNamespace: options.sourceNamespace, observedAt: occurredAt, delivery,
                notification: { method: 'item/completed', params: { threadId, turnId: turn.id, item } } });
              if (result.kind === 'unavailable' && result.reason === 'capacity-exceeded') {
                failHistorySource('Handoff history capacity reached; handoffs unavailable for this history.', false);
                return;
              }
              if (result.kind === 'observed') for (const handoff of result.handoffs) {
                publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: handoff.handoffId,
                  occurredAt, source: 'codex', type: 'handoff.observed', agentId: handoff.fromAgentId, data: { handoff } });
              }
            }
          }
          baselined.add(threadId);
        }
      }
      function enableAfterBaseline(notify: boolean) {
        if (enabled || sourceFailed || !state || baselined.size === 0 || state.connection.status !== 'connected' ||
          state.agents.filter(a => liveAgent(state!, a.agentId)).some(a => !baselined.has(a.agentId))) return;
        enabled = true;
        state.capabilities.observeHandoffs = { supported: true, reason: 'Verified passive history reader.' };
        state.connection = { ...state.connection, message: handoffConnectionMessage };
        if (notify) publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
          occurredAt: now(), source: 'codex', type: 'capabilities.changed', agentId: null,
          data: { capabilities: structuredClone(state.capabilities) } });
        if (notify) publish({ protocolVersion: 1, bridgeEpoch: wrapEpoch, seq: 0, eventId: randomUUID(),
          occurredAt: now(), source: 'codex', type: 'connection.changed', agentId: null,
          data: { connection: structuredClone(state.connection) } });
      }
      if (reader) { try { await scan(); } catch { failHistorySource(); } }
      enableAfterBaseline(false);
      const tick = async () => {
        if (stopped || sourceFailed) return;
        try { await scan(); enableAfterBaseline(true); } catch { failHistorySource(); }
        finally { if (!stopped && !sourceFailed) timer = setTimeout(() => void tick(), pollMs); }
      };
      // An empty office is not a failed source: keep watching for its first arrival.
      if (!sourceFailed) timer = setTimeout(() => void tick(), reader ? pollMs : 0);
    }
    return {
      initialSnapshot: () => structuredClone(state!),
      subscribe(listener) { if (!stopped) listeners.add(listener); return () => { listeners.delete(listener); }; },
      async stop() { if (stopped) return; stopped = true; clearTimeout(timer); listeners.clear(); unsubscribe(); await Promise.all([options.base.stop(), reader?.close()]); },
    };
  } catch (error) {
    stopped = true; clearTimeout(timer); unsubscribe(); await Promise.all([options.base.stop(), reader?.close()]);
    throw error;
  }
}
