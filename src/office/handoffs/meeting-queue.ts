import type { OfficeAgent, OfficeHandoff, PresentationState } from '../../shared/contract';

export interface MeetingToken { generation: number; serial: number; handoffId: string }
export interface Meeting { token: MeetingToken; handoff: OfficeHandoff }
export interface HiddenHandoffSignal {
  handoff: OfficeHandoff;
  hiddenAgentIds: string[];
  groupAgentIds: string[];
}
export type MeetingEndReason = 'completed' | 'reset' | 'presentation-paused' | 'participant-unavailable' | 'participant-hidden';
export type MeetingEffect =
  | { type: 'start'; meeting: Meeting }
  | { type: 'end'; meeting: Meeting; reason: MeetingEndReason; agents: OfficeAgent[]; visibleAgentIds: string[] }
  | { type: 'hidden'; signal: HiddenHandoffSignal }
  | { type: 'clear-hidden'; handoffId: string };
export type MeetingAdmission =
  | { status: 'started' | 'queued' | 'hidden' | 'duplicate' }
  | { status: 'dropped'; reason: 'invalid-handoff' | 'participant-unavailable' | 'participant-already-queued' | 'queue-full' };
export interface MeetingQueueState {
  active: Meeting | null;
  queued: OfficeHandoff[];
  hiddenSignals: HiddenHandoffSignal[];
  dropped: number;
  maxQueued: number;
}
export interface MeetingQueue {
  setAgents(agents: readonly OfficeAgent[], visibleAgentIds: readonly string[], eligibleAgentIds?: readonly string[]): void;
  setPresentation(state: PresentationState): void;
  observe(handoff: OfficeHandoff): MeetingAdmission;
  seedHistory(handoffs: readonly OfficeHandoff[]): void;
  complete(token: MeetingToken): boolean;
  reset(): void;
  getState(): MeetingQueueState;
  drainEffects(): MeetingEffect[];
}

const participants = (handoff: OfficeHandoff): string[] => [handoff.fromAgentId, handoff.toAgentId];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const valid = (handoff: OfficeHandoff): boolean => !!handoff && text(handoff.handoffId)
  && text(handoff.sourceItemId) && text(handoff.fromAgentId) && text(handoff.toAgentId)
  && handoff.fromAgentId !== handoff.toAgentId;
const copy = <T>(value: T): T => structuredClone(value);

/**
 * Presentation-only scheduler. One water-cooler pair is active globally; each pet
 * may also have at most one queued meeting. The oldest eligible visible pair runs
 * next, so a hidden group cannot stall unrelated visible pairs. Overflow drops
 * the newest meeting and still remembers its ID. Seen IDs are retained for this
 * queue's lifetime; recreate only with an authoritative snapshot/history seed.
 *
 * Consume effects in order. A scene calls complete with the exact start token.
 * No timers, transport calls, or execution controls are owned by this module.
 */
export function createMeetingQueue(options: { maxQueued?: number } = {}): MeetingQueue {
  const maxQueued = options.maxQueued ?? 8;
  if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new RangeError('maxQueued must be a non-negative integer');
  let agents = new Map<string, OfficeAgent>();
  let visible = new Set<string>();
  let eligible: Set<string> | null = null;
  let presentation: PresentationState = 'ready';
  let generation = 0;
  let serial = 0;
  let active: Meeting | null = null;
  let queued: OfficeHandoff[] = [];
  let effects: MeetingEffect[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  const hidden = new Map<string, HiddenHandoffSignal>();

  function unavailable(handoff: OfficeHandoff): boolean {
    return participants(handoff).some(id => {
      const agent = agents.get(id);
      return !agent || agent.runtimeState === 'closed' || agent.runtimeState === 'error' || (eligible !== null && !eligible.has(id));
    });
  }
  function hiddenIds(handoff: OfficeHandoff): string[] {
    return participants(handoff).filter(id => !visible.has(id));
  }
  function clearHidden(handoffId: string) {
    if (hidden.delete(handoffId)) effects.push({ type: 'clear-hidden', handoffId });
  }
  function signalHidden(handoff: OfficeHandoff) {
    const ids = hiddenIds(handoff);
    if (!ids.length || unavailable(handoff)) { clearHidden(handoff.handoffId); return; }
    const signal: HiddenHandoffSignal = { handoff: copy(handoff), hiddenAgentIds: ids,
      groupAgentIds: [...new Set(ids.map(id => agents.get(id)?.parentAgentId ?? id))] };
    const previous = hidden.get(handoff.handoffId);
    if (previous && JSON.stringify(previous) === JSON.stringify(signal)) return;
    hidden.set(handoff.handoffId, signal);
    effects.push({ type: 'hidden', signal: copy(signal) });
  }
  function end(reason: MeetingEndReason) {
    if (!active) return;
    const meeting = active;
    active = null;
    // An undelivered start must not briefly reveal a pet after it hides/closes.
    effects = effects.filter(effect => effect.type !== 'start' || effect.meeting.token.serial !== meeting.token.serial);
    const currentAgents = participants(meeting.handoff).flatMap(id => {
      const agent = agents.get(id);
      return agent ? [copy(agent)] : [];
    });
    effects.push({ type: 'end', meeting: copy(meeting), reason, agents: currentAgents,
      visibleAgentIds: currentAgents.filter(agent => visible.has(agent.agentId)).map(agent => agent.agentId) });
  }
  function start(handoff: OfficeHandoff) {
    clearHidden(handoff.handoffId);
    active = { token: { generation, serial: ++serial, handoffId: handoff.handoffId }, handoff: copy(handoff) };
    effects.push({ type: 'start', meeting: copy(active) });
  }
  function pump() {
    if (active || presentation !== 'live') return;
    const index = queued.findIndex(handoff => !unavailable(handoff) && hiddenIds(handoff).length === 0);
    if (index !== -1) start(queued.splice(index, 1)[0]);
  }
  function reconcile() {
    if (active && unavailable(active.handoff)) end('participant-unavailable');
    else if (active && hiddenIds(active.handoff).length) {
      const handoff = active.handoff;
      end('participant-hidden');
      // A shortened active meeting is never reenacted, even after expansion.
      signalHidden(handoff);
    }
    queued = queued.filter(handoff => {
      if (!unavailable(handoff)) return true;
      clearHidden(handoff.handoffId);
      return false;
    });
    for (const signal of [...hidden.values()]) signalHidden(signal.handoff);
    for (const handoff of queued) signalHidden(handoff);
    pump();
  }
  function drop(reason: Extract<MeetingAdmission, { status: 'dropped' }>['reason']): MeetingAdmission {
    dropped++;
    return { status: 'dropped', reason };
  }
  return {
    setAgents(nextAgents, visibleAgentIds, eligibleAgentIds) {
      agents = new Map(nextAgents.map(agent => [agent.agentId, copy(agent)]));
      visible = new Set(visibleAgentIds);
      eligible = eligibleAgentIds ? new Set(eligibleAgentIds) : null;
      reconcile();
    },
    setPresentation(state) {
      presentation = state;
      if (state !== 'live') end('presentation-paused');
      pump();
    },
    observe(input) {
      if (!valid(input)) return drop('invalid-handoff');
      if (seen.has(input.handoffId)) return { status: 'duplicate' };
      const handoff = copy(input);
      seen.add(handoff.handoffId);
      if (unavailable(handoff)) return drop('participant-unavailable');
      pump();
      // A free, visible cooler needs no queue slot, even with maxQueued=0.
      if (!active && presentation === 'live' && hiddenIds(handoff).length === 0) {
        start(handoff);
        return { status: 'started' };
      }
      const ids = participants(handoff);
      if (queued.some(existing => participants(existing).some(id => ids.includes(id)))) return drop('participant-already-queued');
      if (queued.length >= maxQueued) return drop('queue-full');
      queued.push(handoff);
      signalHidden(handoff);
      pump();
      return { status: hiddenIds(handoff).length ? 'hidden' : 'queued' };
    },
    seedHistory(handoffs) {
      for (const handoff of handoffs) if (valid(handoff)) seen.add(handoff.handoffId);
    },
    complete(token) {
      if (!active || token.generation !== active.token.generation || token.serial !== active.token.serial
        || token.handoffId !== active.token.handoffId) return false;
      end('completed');
      pump();
      return true;
    },
    reset() {
      generation++;
      presentation = 'ready';
      // Preserve pending end/restore effects while discarding stale starts.
      effects = effects.filter(effect => effect.type !== 'start');
      end('reset');
      queued = [];
      for (const id of [...hidden.keys()]) clearHidden(id);
    },
    getState: () => copy({ active, queued, hiddenSignals: [...hidden.values()], dropped, maxQueued }),
    drainEffects() {
      const result = effects;
      effects = [];
      // Restore from truth at delivery time, even if completion was queued before
      // a later status/visibility update. Never reveal a subsequently hidden pet.
      return result.map(effect => {
        if (effect.type !== 'end') return effect;
        const currentAgents = participants(effect.meeting.handoff).flatMap(id => {
          const agent = agents.get(id);
          return agent ? [copy(agent)] : [];
        });
        return { ...effect, agents: currentAgents,
          visibleAgentIds: currentAgents.filter(agent => visible.has(agent.agentId)).map(agent => agent.agentId) };
      });
    },
  };
}
