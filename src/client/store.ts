import type { ActivityEntry, OfficeAgent, OfficeEvent, OfficeRequest, OfficeSnapshot } from '../shared/contract';
import { isOfficeEvent, isOfficeSnapshot } from './validation';

export type TransportStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface OfficeClientState {
  snapshot: OfficeSnapshot | null;
  selectedAgentId: string | null;
  transport: { status: TransportStatus; message: string | null };
  error: string | null;
}
export interface OfficeStore {
  getState(): OfficeClientState;
  subscribe(listener: () => void): () => void;
  selectAgent(id: string | null): void;
  applySnapshot(snapshot: OfficeSnapshot): void;
  applyEvent(event: OfficeEvent): void;
  setTransportStatus(status: TransportStatus, message?: string): void;
}
export const RESYNC_REQUIRED = 'Office updates are out of sync. Refreshing the current state.';
export const REPLIES_DISABLED = 'In-office replies are unavailable until request routing is verified. Use the original Codex conversation.';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function history(entries: ActivityEntry[]): ActivityEntry[] {
  const seen = new Set<string>();
  return entries.filter(entry => !seen.has(entry.activityId) && !!seen.add(entry.activityId)).slice(0, 100);
}
function disableReply(request: OfficeRequest): OfficeRequest {
  return { ...request, responseCapability: { supported: false, reason: request.responseCapability.reason || REPLIES_DISABLED } };
}
function normalize(snapshot: OfficeSnapshot): OfficeSnapshot {
  const copy = structuredClone(snapshot);
  copy.capabilities.respondToRequests = { supported: false, reason: copy.capabilities.respondToRequests.reason || REPLIES_DISABLED };
  copy.pendingRequests = copy.pendingRequests.map(disableReply);
  copy.agents = copy.agents.map(agent => ({ ...agent, recentActivity: history(agent.recentActivity),
    pendingRequestIds: [...new Set([...agent.pendingRequestIds, ...copy.pendingRequests.filter(r => r.agentId === agent.agentId).map(r => r.requestId)])] }));
  return copy;
}

export function createOfficeStore(initial?: OfficeSnapshot): OfficeStore {
  let state: OfficeClientState = freeze({ snapshot: null, selectedAgentId: null,
    transport: { status: 'connecting', message: null }, error: null });
  const listeners = new Set<() => void>();
  const eventIds = new Set<string>();
  const retiredEpochs = new Set<string>();
  let requiredEpoch: string | null = null;
  let requiredSeq = 0;
  function update(next: OfficeClientState) {
    state = freeze(next);
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('Office subscriber failed', error); }
    }
  }
  function resync(epoch: string, seq: number) {
    requiredSeq = requiredEpoch === epoch ? Math.max(requiredSeq, seq) : seq;
    requiredEpoch = epoch;
    update({ ...state, error: RESYNC_REQUIRED, transport: { status: 'reconnecting', message: RESYNC_REQUIRED } });
  }
  const store: OfficeStore = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    selectAgent(selectedAgentId) { if (selectedAgentId !== state.selectedAgentId) update({ ...state, selectedAgentId }); },
    setTransportStatus(status, message) { update({ ...state, transport: { status, message: message ?? null } }); },
    applySnapshot(snapshot) {
      if (!isOfficeSnapshot(snapshot)) { update({ ...state, error: 'Invalid office snapshot received.' }); return; }
      const current = state.snapshot;
      if (retiredEpochs.has(snapshot.bridgeEpoch) || (requiredEpoch && snapshot.bridgeEpoch !== requiredEpoch)
        || (requiredEpoch && snapshot.lastSeq < requiredSeq)
        || (current?.bridgeEpoch === snapshot.bridgeEpoch && snapshot.lastSeq < current.lastSeq)) return;
      if (current && current.bridgeEpoch !== snapshot.bridgeEpoch) { retiredEpochs.add(current.bridgeEpoch); eventIds.clear(); }
      requiredEpoch = null;
      requiredSeq = 0;
      update({ ...state, snapshot: normalize(snapshot), error: null });
    },
    applyEvent(event) {
      if (!isOfficeEvent(event)) { update({ ...state, error: 'Invalid office event received.' }); return; }
      const current = state.snapshot;
      if (retiredEpochs.has(event.bridgeEpoch)) return;
      if (!current || event.bridgeEpoch !== current.bridgeEpoch) { resync(event.bridgeEpoch, event.seq); return; }
      if (event.seq <= current.lastSeq) return;
      if (requiredEpoch || event.seq !== current.lastSeq + 1) { resync(event.bridgeEpoch, event.seq); return; }
      const next = { ...current, lastSeq: event.seq };
      if (!eventIds.has(event.eventId)) {
        const e = structuredClone(event);
        const changeAgent = (fn: (agent: OfficeAgent) => OfficeAgent) => {
          next.agents = next.agents.map(agent => agent.agentId === e.agentId ? fn(agent) : agent);
        };
        switch (e.type) {
          case 'agent.upserted': {
            const previous = next.agents.find(agent => agent.agentId === e.agentId);
            const agent = { ...e.data.agent, recentActivity: history([...e.data.agent.recentActivity, ...(previous?.recentActivity ?? [])]),
              pendingRequestIds: [...new Set([...e.data.agent.pendingRequestIds, ...(previous?.pendingRequestIds ?? []),
                ...next.pendingRequests.filter(r => r.agentId === e.agentId).map(r => r.requestId)])] };
            next.agents = previous ? next.agents.map(a => a.agentId === agent.agentId ? agent : a) : [...next.agents, agent];
            break;
          }
          case 'agent.activity': changeAgent(a => ({ ...a, activityKind: e.data.activity.kind, lastObservedAt: e.occurredAt,
            recentActivity: history([e.data.activity, ...a.recentActivity]) })); break;
          case 'agent.state.changed': changeAgent(a => ({ ...a, runtimeState: e.data.runtimeState, lastObservedAt: e.occurredAt })); break;
          // Completion is an observed work item, not proof that the session closed (or its next turn is idle).
          case 'agent.work.completed': break;
          case 'agent.closed': changeAgent(a => ({ ...a, runtimeState: 'closed', lastObservedAt: e.occurredAt })); break;
          case 'request.opened': {
            const request = disableReply(e.data.request);
            next.pendingRequests = [...next.pendingRequests.filter(r => r.requestId !== request.requestId), request];
            changeAgent(a => ({ ...a, pendingRequestIds: [...new Set([...a.pendingRequestIds, request.requestId])] }));
            break;
          }
          case 'request.resolved': {
            const matching = next.pendingRequests.find(r => r.requestId === e.data.requestId);
            // A mismatched owner must never clear another agent's attention.
            if (!matching || e.agentId === null || matching.agentId === e.agentId) {
              next.pendingRequests = next.pendingRequests.filter(r => r.requestId !== e.data.requestId);
              next.agents = next.agents.map(a => e.agentId === null || a.agentId === e.agentId
                ? { ...a, pendingRequestIds: a.pendingRequestIds.filter(id => id !== e.data.requestId) } : a);
            }
            break;
          }
          case 'handoff.observed': next.recentHandoffs = [e.data.handoff, ...next.recentHandoffs.filter(h => h.handoffId !== e.data.handoff.handoffId)].slice(0, 100); break;
          case 'connection.changed': next.connection = e.data.connection; break;
          case 'presentation.changed': next.officeSessionId = e.data.officeSessionId; next.presentation = { state: e.data.state, canSkip: e.data.canSkip }; break;
        }
        eventIds.add(e.eventId);
        if (eventIds.size > 4096) eventIds.delete(eventIds.values().next().value!);
      }
      update({ ...state, snapshot: next, error: null });
    },
  };
  if (initial !== undefined) store.applySnapshot(initial);
  return store;
}
