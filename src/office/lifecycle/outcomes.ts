/** Presentation only: these states never stop, archive, or remove a runtime session. */
export type OutcomePose = 'awake' | 'dying' | 'dead' | 'sleeping';
export type PresentedTurnStatus = 'started' | 'succeeded' | 'failed' | 'interrupted';
export type OutcomeAnimation = 'die' | 'sleep' | 'wake' | 'arrive';

export interface OutcomePresentationState {
  readonly pose: OutcomePose;
  readonly visible: boolean;
  readonly pendingDeathToken: string | null;
  readonly lastObservationToken: string | null;
}

export interface OutcomePresentation {
  readonly state: OutcomePresentationState;
  readonly effect: OutcomeAnimation | null;
}

export function createOutcomePresentation(
  pose: Exclude<OutcomePose, 'dying'> = 'awake',
  visible = pose !== 'dead',
): OutcomePresentationState {
  return { pose, visible: pose !== 'dead' && visible, pendingDeathToken: null, lastObservationToken: null };
}

/**
 * The caller supplies a unique, generation-scoped token for each accepted observation.
 * Baselines establish a settled pose without replaying historical animations.
 * Successful exits belong to the office movement controller; this clears any old death.
 */
export function presentTurnOutcome(previous: OutcomePresentationState, input: {
  status: PresentedTurnStatus | 'unknown' | 'disconnected';
  token: string;
  mode: 'live' | 'baseline';
}): OutcomePresentation {
  if (input.status === 'unknown' || input.status === 'disconnected' ||
      (input.mode === 'live' && input.token === previous.lastObservationToken)) {
    return { state: previous, effect: null };
  }

  const base = { pendingDeathToken: null, lastObservationToken: input.token };
  const live = input.mode === 'live';
  switch (input.status) {
    case 'failed':
      return {
        state: live
          ? { ...base, pose: 'dying', visible: true, pendingDeathToken: input.token }
          : { ...base, pose: 'dead', visible: false },
        effect: live ? 'die' : null,
      };
    case 'interrupted':
      return {
        state: { ...base, pose: 'sleeping', visible: true },
        effect: live && previous.pose !== 'sleeping' ? 'sleep' : null,
      };
    case 'started':
      return {
        state: { ...base, pose: 'awake', visible: true },
        effect: !live ? null : !previous.visible ? 'arrive' : previous.pose === 'sleeping' ? 'wake' : null,
      };
    case 'succeeded':
      return { state: { ...base, pose: 'awake', visible: previous.visible }, effect: null };
  }
}

/** Hide only the sprite whose currently pending death animation has completed. */
export function settleTurnOutcome(state: OutcomePresentationState, token: string): OutcomePresentationState {
  if (state.pose !== 'dying' || state.pendingDeathToken !== token) return state;
  return { ...state, pose: 'dead', visible: false, pendingDeathToken: null };
}
