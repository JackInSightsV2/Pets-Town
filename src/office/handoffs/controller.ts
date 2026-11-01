import type { OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import { createOfficeStore, type OfficeStore } from '../../client/store.js';
import { isOfficeEvent, isOfficeSnapshot } from '../../client/validation.js';
import { createMeetingQueue, type MeetingToken } from './meeting-queue.js';

export type HandoffDelivery = 'applied' | 'ignored' | 'snapshot-required' | 'unavailable';

/**
 * Presentation-only consumer of the existing snapshot/SSE boundary.
 * Route snapshots/events through these methods; the supplied store still notifies its UI.
 * Snapshot handoffs seed deduplication and never start choreography.
 */
export function createHandoffController(options: { store?: OfficeStore; maxQueued?: number } = {}) {
  const store = options.store ?? createOfficeStore();
  const queue = createMeetingQueue({ maxQueued: options.maxQueued });
  let visibleAgentIds: string[] = [];
  const refreshAgents = () => queue.setAgents(store.getState().snapshot?.agents ?? [], visibleAgentIds);

  return {
    store,
    applySnapshot(snapshot: OfficeSnapshot, visible: readonly string[]): HandoffDelivery {
      if (!isOfficeSnapshot(snapshot)) return 'unavailable';
      const previous = store.getState().snapshot;
      store.applySnapshot(snapshot);
      const next = store.getState().snapshot;
      if (!next || next === previous) return 'ignored';
      visibleAgentIds = [...visible];
      queue.reset();
      refreshAgents();
      queue.seedHistory(next.recentHandoffs);
      queue.setPresentation(next.presentation.state);
      return 'applied';
    },
    applyEvent(event: OfficeEvent): HandoffDelivery {
      if (!isOfficeEvent(event)) return 'unavailable';
      const previous = store.getState().snapshot;
      store.applyEvent(event);
      const state = store.getState();
      const next = state.snapshot;
      if (state.error) {
        // Stop stale animation while the existing transport obtains a fresh snapshot.
        queue.reset();
        return 'snapshot-required';
      }
      if (!next || next === previous || next.lastSeq !== event.seq) return 'ignored';
      if (previous?.officeSessionId !== next.officeSessionId) queue.reset();
      refreshAgents();
      queue.setPresentation(next.presentation.state);
      if (event.type !== 'handoff.observed') return 'applied';
      if (!next.capabilities.observeHandoffs.supported || event.source === 'office' ||
          event.source !== next.source || event.agentId !== event.data.handoff.fromAgentId) return 'unavailable';
      queue.observe(event.data.handoff);
      return 'applied';
    },
    setVisibleAgents(visible: readonly string[]) {
      visibleAgentIds = [...visible];
      refreshAgents();
    },
    complete(token: MeetingToken) { return queue.complete(token); },
    getState: () => queue.getState(),
    drainEffects: () => queue.drainEffects(),
  };
}
