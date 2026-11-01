import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LifecycleStore } from '../client/lifecycle';
import type { HandoffStore } from '../client/handoffs';
import { createOfficeBehaviorController, type OfficeBehaviorInput } from '../office/behavior/controller';

interface BehaviorSource { lifecycle: LifecycleStore; handoffs: HandoffStore }
const OfficeBehaviorContext = createContext<BehaviorSource | null>(null);
export function OfficeBehaviorProvider({ value, children }: { value: BehaviorSource; children: ReactNode }) {
  return <OfficeBehaviorContext value={value}>{children}</OfficeBehaviorContext>;
}
const noSubscription = () => () => {};
const emptyLifecycle = { sprites: [], snapshotRevision: 0 };
const getEmptyLifecycle = () => emptyLifecycle;
const getNull = () => null;

export function useCompleteSceneLifecycle() {
  return useContext(OfficeBehaviorContext)?.lifecycle.completeLifecycle;
}

export function useSceneLifecycles() {
  const source = useContext(OfficeBehaviorContext);
  return useSyncExternalStore(source?.lifecycle.subscribeLifecycle ?? noSubscription,
    source?.lifecycle.getLifecycleState ?? getEmptyLifecycle, getEmptyLifecycle).sprites;
}

/** Source snapshots, lifecycle, and real meetings are read before decoration.
 * A single scene clock drives all visual timing; token completion goes back only
 * to presentation controllers, never to Codex execution or messaging APIs.
 */
export function useOfficeBehavior(input: Omit<OfficeBehaviorInput, 'lifecycles' | 'snapshotRevision' | 'transportConnected' | 'realHandoffPending'>,
  onMeetingComplete?: HandoffStore['completeMeeting'], observerConnected = true) {
  const source = useContext(OfficeBehaviorContext);
  const lifecycle = useSyncExternalStore(source?.lifecycle.subscribeLifecycle ?? noSubscription,
    source?.lifecycle.getLifecycleState ?? getEmptyLifecycle, getEmptyLifecycle);
  const client = useSyncExternalStore(source?.lifecycle.subscribe ?? noSubscription, source?.lifecycle.getState ?? getNull, getNull);
  const meetings = useSyncExternalStore(source?.handoffs.subscribeMeetings ?? noSubscription, source?.handoffs.getMeetingState ?? getNull, getNull);
  const controller = useRef<ReturnType<typeof createOfficeBehaviorController> | null>(null);
  controller.current ??= createOfficeBehaviorController();
  const [, tick] = useState(0);
  const connected = observerConnected && (client ? client.transport.status === 'connected' && !client.error : input.snapshot?.connection.status === 'connected');
  const frame = controller.current.update({ ...input, lifecycles: lifecycle.sprites, snapshotRevision: lifecycle.snapshotRevision,
    transportConnected: connected, realHandoffPending: !!input.meeting || !!meetings?.queued.length }, performance.now());
  useEffect(() => {
    if (!connected || !input.snapshot) return;
    const timer = window.setInterval(() => tick(value => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [connected, !!input.snapshot]);
  useLayoutEffect(() => {
    for (const token of frame.completedLifecycles) source?.lifecycle.completeLifecycle(token);
    for (const token of frame.completedMeetings) onMeetingComplete?.(token);
    controller.current?.acknowledge(frame);
  }, [frame, source, onMeetingComplete]);
  return frame;
}
