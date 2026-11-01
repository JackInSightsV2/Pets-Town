import type { OfficeAgent, PresentationState } from '../../shared/contract.js';
import { isTurnLifecycleObservation, type TurnLifecycleObservation } from '../../shared/turn-lifecycle.js';
import { createOutcomePresentation, presentTurnOutcome, settleTurnOutcome, type OutcomePose, type OutcomePresentationState } from './outcomes.js';

export interface LifecycleToken { generation: number; serial: number; agentId: string; turnId: string }
export type LifecyclePhase = 'unknown' | 'present' | 'entering' | 'leaving' | 'absent' | 'dying' | 'sleeping';
export interface SpriteLifecycle {
  agentId: string;
  turnId: string | null;
  status: TurnLifecycleObservation['status'] | null;
  phase: LifecyclePhase;
  pose: OutcomePose;
  /** null means initial presence is unestablished; the UI must choose an explicit fallback. */
  visible: boolean | null;
  attention: boolean;
  meetingEligible: boolean;
  token: LifecycleToken | null;
}
export interface LifecycleEffect { type: 'enter' | 'exit' | 'die' | 'sleep' | 'wake'; token: LifecycleToken }
export interface LifecycleBaseline {
  agents: readonly OfficeAgent[];
  /** At most one verified latest Turn per agent, not every historical terminal turn. */
  latestTurns: readonly TurnLifecycleObservation[];
  connected: boolean;
  presentation: PresentationState;
}
type Entry = { observation: TurnLifecycleObservation | null; phase: LifecyclePhase; outcome: OutcomePresentationState; token: LifecycleToken | null };
const clone = <T>(value: T): T => structuredClone(value);
const tokenKey = (token: LifecycleToken) => JSON.stringify([token.generation, token.serial, token.agentId, token.turnId]);
const waiting = (agent: OfficeAgent) => agent.pendingRequestIds.length > 0 || agent.runtimeState === 'waiting-for-input' || agent.runtimeState === 'waiting-for-approval';

/**
 * Presentation only. Never changes a runtime agent, request, selection or layout.
 * Feed accepted ordered source observations, not snapshot diffs. Keep this
 * instance across reconnects; baseline() seeds/settles without replay. The returned
 * generation must be captured by the delivery subscription and animation callback.
 */
export function createTurnLifecycleController(options: { maxObservations?: number } = {}) {
  const capacity = options.maxObservations ?? 10_000;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid lifecycle capacity.');
  let generation = 0, motionGeneration = 0, serial = 0;
  let connected = false;
  let presentation: PresentationState = 'ready';
  let agents = new Map<string, OfficeAgent>();
  const entries = new Map<string, Entry>();
  // Never evict: a full controller fails closed until an authoritative rebuild.
  const seen = new Map<string, string>();
  const terminals = new Map<string, TurnLifecycleObservation['status']>();
  const retiredTurns = new Set<string>();
  let effects: LifecycleEffect[] = [];
  const fresh = (): Entry => ({ observation: null, phase: 'unknown', outcome: createOutcomePresentation(), token: null });
  function settle(entry: Entry) {
    if (!entry.observation) return;
    const status = entry.observation.status;
    entry.outcome = presentTurnOutcome(entry.outcome, { status, token: entry.observation.sourceEventId, mode: 'baseline' }).state;
    entry.phase = status === 'started' ? 'present' : status === 'interrupted' ? 'sleeping' : 'absent';
    if (status === 'succeeded') entry.outcome = { ...entry.outcome, visible: false };
    entry.token = null;
  }
  function cancelMotion(invalidateDelivery = false) {
    motionGeneration++;
    if (invalidateDelivery) generation++;
    effects = [];
    for (const entry of entries.values()) settle(entry);
  }
  function remember(observation: TurnLifecycleObservation): 'new' | 'duplicate' | 'conflict' | 'full' {
    const owner = seen.get(observation.sourceEventId);
    if (owner) return owner === observation.agentId ? 'duplicate' : 'conflict';
    if (seen.size >= capacity) return 'full';
    seen.set(observation.sourceEventId, observation.agentId);
    return 'new';
  }
  function view(agentId: string, entry: Entry): SpriteLifecycle {
    const agent = agents.get(agentId)!;
    const attention = waiting(agent);
    return { agentId, turnId: entry.observation?.turnId ?? null, status: entry.observation?.status ?? null,
      phase: entry.phase, pose: entry.outcome.pose,
      visible: attention ? true : entry.phase === 'unknown' ? null : entry.outcome.visible,
      attention, meetingEligible: connected && presentation === 'live' && agent.runtimeState !== 'closed' && agent.runtimeState !== 'error'
        && !attention && entry.phase === 'present' && entry.outcome.pose === 'awake', token: clone(entry.token) };
  }
  return {
    baseline(input: LifecycleBaseline): number {
      cancelMotion(true);
      agents = new Map(input.agents.map(agent => [agent.agentId, clone(agent)]));
      connected = input.connected;
      presentation = input.presentation;
      for (const id of [...entries.keys()]) if (!agents.has(id)) entries.delete(id);
      for (const id of agents.keys()) if (!entries.has(id)) entries.set(id, fresh());
      const counts = new Map<string, number>();
      for (const row of input.latestTurns) if (isTurnLifecycleObservation(row)) counts.set(row.agentId, (counts.get(row.agentId) ?? 0) + 1);
      for (const observation of input.latestTurns) {
        if (!isTurnLifecycleObservation(observation) || !agents.has(observation.agentId) || counts.get(observation.agentId) !== 1) continue;
        const entry = entries.get(observation.agentId)!;
        const previous = entry.observation;
        const terminal = terminals.get(observation.turnId);
        if (retiredTurns.has(observation.turnId) || (terminal && terminal !== observation.status)
            || (previous?.startedAt != null && observation.startedAt != null && observation.startedAt < previous.startedAt)) continue;
        const result = remember(observation);
        if (result === 'conflict' || result === 'full') continue;
        if (previous && previous.turnId !== observation.turnId) retiredTurns.add(previous.turnId);
        entry.observation = clone(observation);
        if (observation.status !== 'started') terminals.set(observation.turnId, observation.status);
        settle(entry);
      }
      return generation;
    },
    /** An accepted authoritative snapshot after reconnect is required before live delivery resumes. */
    suspend(): void { connected = false; cancelMotion(true); },
    setPresentation(state: PresentationState): void {
      if (state !== presentation) { presentation = state; cancelMotion(); }
    },
    setAgents(next: readonly OfficeAgent[]): void {
      agents = new Map(next.map(agent => [agent.agentId, clone(agent)]));
      for (const id of [...entries.keys()]) if (!agents.has(id)) entries.delete(id);
      effects = effects.filter(effect => agents.has(effect.token.agentId));
      for (const agent of agents.values()) {
        if (!entries.has(agent.agentId)) entries.set(agent.agentId, fresh());
        const entry = entries.get(agent.agentId)!;
        if (waiting(agent) && entry.token) {
          settle(entry);
          effects = effects.filter(effect => effect.token.agentId !== agent.agentId);
        }
      }
    },
    observe(observation: TurnLifecycleObservation, deliveryGeneration: number): 'applied' | 'duplicate' | 'ignored' | 'unavailable' {
      if (deliveryGeneration !== generation || !connected) return 'ignored';
      if (!isTurnLifecycleObservation(observation) || !agents.has(observation.agentId)) return 'unavailable';
      // Late discovery and source reconnect may deliver a latest-turn baseline
      // after the roster snapshot. It is authoritative presence, never motion.
      if (observation.delivery === 'history') {
        const entry = entries.get(observation.agentId)!;
        const previous = entry.observation;
        const terminal = terminals.get(observation.turnId);
        if (retiredTurns.has(observation.turnId) || (terminal && terminal !== observation.status)
            || (previous?.startedAt != null && observation.startedAt != null && observation.startedAt < previous.startedAt)) return 'ignored';
        const result = remember(observation);
        if (result === 'conflict' || result === 'full') return 'unavailable';
        if (previous && previous.turnId !== observation.turnId) retiredTurns.add(previous.turnId);
        if (observation.status !== 'started') terminals.set(observation.turnId, observation.status);
        entry.observation = clone(observation);
        effects = effects.filter(effect => effect.token.agentId !== observation.agentId);
        settle(entry);
        return 'applied';
      }
      const result = remember(observation);
      if (result === 'duplicate') return 'duplicate';
      if (result !== 'new') return 'unavailable';
      const entry = entries.get(observation.agentId)!;
      const previous = entry.observation;
      const terminal = terminals.get(observation.turnId);
      if (retiredTurns.has(observation.turnId) || terminal) return 'ignored';
      if (previous?.startedAt != null && observation.startedAt != null && observation.startedAt < previous.startedAt) return 'ignored';
      // Late completion from turn A must never hide the newly started turn B.
      // Missing starts must be reconciled through a settled latest-turn baseline.
      if (observation.status !== 'started' && previous?.turnId !== observation.turnId) return 'ignored';
      if (previous && previous.turnId !== observation.turnId) retiredTurns.add(previous.turnId);
      if (observation.status !== 'started') terminals.set(observation.turnId, observation.status);
      effects = effects.filter(effect => effect.token.agentId !== observation.agentId);
      const wasVisible = entry.outcome.visible && entry.phase !== 'unknown';
      entry.observation = clone(observation);
      const live = observation.delivery === 'live' && presentation === 'live' && !waiting(agents.get(observation.agentId)!);
      if (!live) { settle(entry); return 'applied'; }
      const token = { generation: motionGeneration, serial: ++serial, agentId: observation.agentId, turnId: observation.turnId };
      const outcome = presentTurnOutcome(entry.outcome, { status: observation.status, token: tokenKey(token), mode: 'live' });
      entry.outcome = outcome.state;
      entry.token = token;
      let effect: LifecycleEffect['type'] | null = null;
      switch (observation.status) {
        case 'started':
          entry.phase = wasVisible ? 'present' : 'entering';
          effect = !wasVisible ? 'enter' : outcome.effect === 'wake' ? 'wake' : null;
          break;
        case 'succeeded': entry.phase = wasVisible ? 'leaving' : 'absent'; effect = wasVisible ? 'exit' : null; break;
        case 'failed': entry.phase = 'dying'; effect = 'die'; break;
        case 'interrupted': entry.phase = 'sleeping'; effect = outcome.effect === 'sleep' ? 'sleep' : null; break;
      }
      if (effect) effects.push({ type: effect, token: clone(token) });
      else { entry.token = null; if (entry.phase === 'absent') entry.outcome = { ...entry.outcome, visible: false }; }
      return 'applied';
    },
    complete(token: LifecycleToken): boolean {
      const entry = entries.get(token.agentId);
      if (!entry?.token || tokenKey(entry.token) !== tokenKey(token) || token.generation !== motionGeneration) return false;
      if (entry.phase === 'dying') entry.outcome = settleTurnOutcome(entry.outcome, tokenKey(token));
      settle(entry);
      effects = effects.filter(effect => tokenKey(effect.token) !== tokenKey(token));
      return true;
    },
    getGeneration: () => generation,
    getState: (): SpriteLifecycle[] => [...entries].map(([id, entry]) => view(id, entry)),
    drainEffects(): LifecycleEffect[] { const result = effects; effects = []; return clone(result); },
  };
}
