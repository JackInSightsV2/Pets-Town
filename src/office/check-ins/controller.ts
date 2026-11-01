import type { OfficeAgent, OfficeSnapshot, PetAsset } from '../../shared/contract';

export const CHECK_IN_INTERVAL_MS = 45_000;
export const CHECK_IN_DURATION_MS = 2_000;

export interface CheckInToken { generation: number; serial: number }
export interface DecorativeCheckIn {
  kind: 'decorative-check-in';
  token: CheckInToken;
  parentAgentId: string;
  childAgentId: string;
  startedAt: number;
  endsAt: number;
}
export interface CheckInInput {
  snapshot: Pick<OfficeSnapshot, 'bridgeEpoch' | 'officeSessionId' | 'presentation' | 'connection' | 'agents' | 'pendingRequests'> | null;
  transportConnected: boolean;
  /** Actual rendered native pets, after visibility and lifecycle filtering. */
  visibleAgentIds: readonly string[];
  /** Pets owned by arrival, exit, death, sleep, or other higher-priority motion. */
  reservedAgentIds: readonly string[];
  /** True while any real handoff is active or queued. Apply its updates first. */
  realHandoffPending: boolean;
}

type Pair = { parentAgentId: string; childAgentId: string };
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const comparePair = (left: Pair, right: Pair) => compareText(left.parentAgentId, right.parentAgentId)
  || compareText(left.childAgentId, right.childAgentId);
const copy = (checkIn: DecorativeCheckIn | null) => checkIn ? { ...checkIn, token: { ...checkIn.token } } : null;

/**
 * Finite, presentation-only decoration: no events, runtime writes, timers, or
 * movement coordinates. The scene calls update with current truth and monotonic
 * time before rendering. One pair may wave in place; the layout owns proximity.
 * Keep one controller per scene lifetime. Reset on authoritative snapshot
 * replacement as well as presentation reset. Pass both active and queued real
 * meetings as realHandoffPending, and lifecycle movement owners as reservations.
 * On cancellation, remove the animation override and render current scene truth;
 * there is no captured home position or runtime state to restore.
 */
export function createCheckInController(options: { intervalMs?: number; durationMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? CHECK_IN_INTERVAL_MS;
  const durationMs = options.durationMs ?? CHECK_IN_DURATION_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('Check-in interval and duration must be finite and positive');
  }
  let active: DecorativeCheckIn | null = null;
  let sessionKey: string | null = null;
  let previousPair: Pair | null = null;
  let nextAt: number | null = null;
  let generation = 0;
  let serial = 0;
  let lastNow = 0;

  function clock(now: number) {
    if (!Number.isFinite(now) || now < lastNow) throw new RangeError('Use one non-negative monotonic clock for check-ins');
    lastNow = now;
  }
  function end(now: number) {
    active = null;
    nextAt = now + intervalMs;
  }
  function reset() {
    active = null;
    sessionKey = null;
    previousPair = null;
    nextAt = null;
    generation++;
  }

  return {
    update(input: CheckInInput, now: number): DecorativeCheckIn | null {
      clock(now);
      const { snapshot } = input;
      const key = snapshot ? JSON.stringify([snapshot.bridgeEpoch, snapshot.officeSessionId]) : null;
      if (key !== sessionKey) {
        reset();
        sessionKey = key;
      }
      if (!snapshot || !input.transportConnected || snapshot.connection.status !== 'connected'
        || snapshot.presentation.state !== 'live' || input.realHandoffPending) {
        end(now);
        return null;
      }
      const visible = new Set(input.visibleAgentIds);
      const reserved = new Set(input.reservedAgentIds);
      const attention = new Set(snapshot.pendingRequests.map(request => request.agentId));
      const agents = new Map(snapshot.agents.map(agent => [agent.agentId, agent]));
      const available = (agent: OfficeAgent) => visible.has(agent.agentId) && !reserved.has(agent.agentId)
        && !attention.has(agent.agentId) && agent.pendingRequestIds.length === 0
        && (agent.runtimeState === 'working' || agent.runtimeState === 'idle');
      const pairs: Pair[] = [];
      for (const child of agents.values()) {
        const parent = child.parentAgentId ? agents.get(child.parentAgentId) : undefined;
        if (child.runtimeState !== 'working' || !parent || parent.agentId === child.agentId
          || !available(parent) || !available(child)) continue;
        pairs.push({ parentAgentId: parent.agentId, childAgentId: child.agentId });
      }
      pairs.sort(comparePair);
      if (active) {
        if (now >= active.endsAt || !pairs.some(pair => comparePair(pair, active!) === 0)) end(now);
        // Never replace a cancelled/expired run in the same update.
        return copy(active);
      }
      if (!pairs.length) {
        nextAt = now + intervalMs;
        return null;
      }
      nextAt ??= now + intervalMs;
      if (now < nextAt) return null;
      const pair = pairs.find(candidate => previousPair && comparePair(candidate, previousPair) > 0) ?? pairs[0];
      previousPair = { ...pair };
      active = { kind: 'decorative-check-in', token: { generation, serial: ++serial }, ...pair,
        startedAt: now, endsAt: now + durationMs };
      return copy(active);
    },
    /** Optional early animation completion; an old callback cannot affect a new pair. */
    complete(token: CheckInToken, now: number): boolean {
      if (!active || token.generation !== active.token.generation || token.serial !== active.token.serial) return false;
      clock(now);
      end(now);
      return true;
    },
    reset,
    getState: () => copy(active),
  };
}

/** Use NativePet's animationName seam; never substitute a runtime state. */
export function checkInAnimationName(checkIn: DecorativeCheckIn | null, agentId: string, asset: PetAsset, reducedMotion: boolean): string | undefined {
  if (reducedMotion || !checkIn || (agentId !== checkIn.parentAgentId && agentId !== checkIn.childAgentId)) return undefined;
  return asset.animations.waving ? 'waving' : undefined;
}
