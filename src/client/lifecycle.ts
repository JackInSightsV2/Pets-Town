import type { OfficeEvent, OfficeSnapshot } from '../shared/contract';
import { isTurnLifecycleObservation } from '../shared/turn-lifecycle';
import { createTurnLifecycleController, type LifecycleToken, type SpriteLifecycle } from '../office/lifecycle/controller';
import { createOfficeStore, type OfficeClientState, type OfficeStore } from './store';

export interface OfficeLifecycleState {
  sprites: SpriteLifecycle[];
  /** Accepted authoritative replacements, including replacements in the same session. */
  snapshotRevision: number;
}

export interface LifecycleStore extends OfficeStore {
  getLifecycleState(): OfficeLifecycleState;
  subscribeLifecycle(listener: () => void): () => void;
  completeLifecycle(token: LifecycleToken): boolean;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Lifecycle consumes only evidence accepted by the existing sequence/epoch gate.
 * Keep this store for the connection lifetime: reconnect suspends delivery until
 * another authoritative snapshot, and no runtime-state diff implies an outcome.
 * The wrapper publishes after both stores advance, so subscribers see one view.
 */
export function createLifecycleStore(initial?: OfficeSnapshot): LifecycleStore {
  const store = createOfficeStore();
  const controller = createTurnLifecycleController();
  const listeners = new Set<() => void>();
  const lifecycleListeners = new Set<() => void>();
  // Match the underlying store's accepted-envelope dedup window. An in-order
  // repeated eventId advances its sequence without applying the repeated payload.
  const eventIds = new Set<string>();
  let deliveryGeneration = controller.getGeneration();
  let baselineReady = false;
  let snapshotRevision = 0;
  let lifecycleState: OfficeLifecycleState = freeze({ sprites: [], snapshotRevision });
  let lifecycleKey = JSON.stringify(lifecycleState);

  function suspend() {
    if (!baselineReady) return;
    baselineReady = false;
    controller.suspend();
    deliveryGeneration = controller.getGeneration();
  }

  function publish(previous: OfficeClientState) {
    const next = { sprites: controller.getState(), snapshotRevision };
    const nextKey = JSON.stringify(next);
    const lifecycleChanged = nextKey !== lifecycleKey;
    if (lifecycleChanged) {
      lifecycleState = freeze(next);
      lifecycleKey = nextKey;
    }
    // The scene consumes the token-bearing view, not a second effect queue.
    controller.drainEffects();
    const notify = (subscribers: Set<() => void>) => {
      for (const listener of [...subscribers]) {
        try { listener(); } catch (error) { console.error('Office lifecycle subscriber failed', error); }
      }
    };
    if (store.getState() !== previous) notify(listeners);
    if (lifecycleChanged) notify(lifecycleListeners);
  }

  const result: LifecycleStore = {
    getState: store.getState,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getLifecycleState: () => lifecycleState,
    subscribeLifecycle(listener) {
      lifecycleListeners.add(listener);
      return () => { lifecycleListeners.delete(listener); };
    },
    selectAgent(id) {
      const previous = store.getState();
      store.selectAgent(id);
      publish(previous);
    },
    applySnapshot(snapshot) {
      const previous = store.getState();
      store.applySnapshot(snapshot);
      const state = store.getState();
      const next = state.snapshot;
      if (state.error) suspend();
      else if (next && next !== previous.snapshot) {
        if (previous.snapshot?.bridgeEpoch !== next.bridgeEpoch) eventIds.clear();
        snapshotRevision++;
        // connectOffice receives this baseline before the new EventSource onopen.
        // Its source connection is authoritative; transport still says reconnecting.
        baselineReady = next.connection.status === 'connected';
        const agentIds = new Set(next.agents.map(agent => agent.agentId));
        deliveryGeneration = controller.baseline({ agents: next.agents,
          latestTurns: (next.latestTurns ?? []).filter(observation => isTurnLifecycleObservation(observation)
            && observation.source === next.source && agentIds.has(observation.agentId)),
          connected: baselineReady, presentation: next.presentation.state });
      }
      publish(previous);
    },
    applyEvent(event: OfficeEvent) {
      const previous = store.getState();
      store.applyEvent(event);
      const state = store.getState();
      const next = state.snapshot;
      if (state.error) suspend();
      else if (next && next !== previous.snapshot && next.lastSeq === event.seq) {
        const repeated = eventIds.has(event.eventId);
        if (!repeated) {
          eventIds.add(event.eventId);
          if (eventIds.size > 4096) eventIds.delete(eventIds.values().next().value!);
        }
        // These are the normalized agent rows, including request records merged
        // into pendingRequestIds. Attention can therefore cancel current motion.
        controller.setAgents(next.agents);
        if (previous.snapshot?.officeSessionId !== next.officeSessionId) controller.setPresentation('ready');
        controller.setPresentation(next.presentation.state);
        if (next.connection.status !== 'connected') suspend();
        if (!repeated && baselineReady && event.type === 'agent.closed' && event.agentId && event.source === next.source) {
          controller.close(event.agentId, event.eventId, deliveryGeneration);
        }
        if (!repeated && baselineReady && event.type === 'agent.turn.observed') {
          const observation = event.data.observation;
          if (isTurnLifecycleObservation(observation) && event.source === next.source
            && observation.source === event.source && observation.agentId === event.agentId) {
            controller.observe(observation, deliveryGeneration);
          }
        }
      }
      publish(previous);
    },
    setTransportStatus(status, message) {
      const previous = store.getState();
      store.setTransportStatus(status, message);
      if (status !== 'connected') suspend();
      // A connected flag alone never establishes delivery continuity.
      publish(previous);
    },
    completeLifecycle(token) {
      const previous = store.getState();
      const completed = controller.complete(token);
      publish(previous);
      return completed;
    },
  };
  if (initial !== undefined) result.applySnapshot(initial);
  return result;
}
