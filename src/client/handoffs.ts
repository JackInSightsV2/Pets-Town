import { createHandoffController } from '../office/handoffs/controller';
import type { MeetingQueueState, MeetingToken } from '../office/handoffs/meeting-queue';
import { createOfficeStore, type OfficeStore } from './store';
import { isOfficeEvent, isOfficeSnapshot } from './validation';

export interface HandoffStore extends OfficeStore {
  getMeetingState(): MeetingQueueState;
  subscribeMeetings(listener: () => void): () => void;
  setVisibleAgents(ids: readonly string[]): void;
  completeMeeting(token: MeetingToken): void;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Single delivery boundary for office truth and presentation-only handoffs. */
export function createHandoffStore(): HandoffStore {
  const store = createOfficeStore();
  const controller = createHandoffController({ store });
  const listeners = new Set<() => void>();
  let visibleAgentIds: string[] = [];
  let meetingState = freeze(controller.getState());
  let meetingKey = JSON.stringify(meetingState);

  function publish() {
    const state = store.getState();
    if (state.error || state.transport.status === 'disconnected' || state.transport.status === 'reconnecting'
      || (state.snapshot && (state.snapshot.connection.status !== 'connected'
        || !state.snapshot.capabilities.observeHandoffs.supported))) {
      // Keep the same queue: reset invalidates callbacks while retaining seen IDs.
      controller.reset();
    }
    const next = controller.getState();
    const nextKey = JSON.stringify(next);
    // This view consumes state, so do not retain the queue's optional scene effects.
    controller.drainEffects();
    if (nextKey === meetingKey) return;
    meetingState = freeze(next);
    meetingKey = nextKey;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('Office meeting subscriber failed', error); }
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    selectAgent: store.selectAgent,
    getMeetingState: () => meetingState,
    subscribeMeetings(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    applySnapshot(snapshot) {
      controller.applySnapshot(snapshot, visibleAgentIds);
      // The controller rejects malformed payloads before delivery; let the store
      // expose its existing validation error, still delivering exactly once.
      if (!isOfficeSnapshot(snapshot)) store.applySnapshot(snapshot);
      publish();
    },
    applyEvent(event) {
      controller.applyEvent(event);
      if (!isOfficeEvent(event)) store.applyEvent(event);
      publish();
    },
    setTransportStatus(status, message) {
      store.setTransportStatus(status, message);
      publish();
    },
    setVisibleAgents(ids) {
      visibleAgentIds = [...ids];
      controller.setVisibleAgents(visibleAgentIds);
      publish();
    },
    completeMeeting(token) {
      controller.complete(token);
      publish();
    },
  };
}
