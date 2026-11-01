import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomePresentation, presentTurnOutcome, settleTurnOutcome } from './outcomes.js';

const live = (status: 'started' | 'succeeded' | 'failed' | 'interrupted', token: string) =>
  ({ status, token, mode: 'live' as const });

test('an observed failure visibly dies before the sprite disappears', () => {
  const initial = Object.freeze(createOutcomePresentation());
  const failure = presentTurnOutcome(initial, live('failed', 'generation-1-failure'));
  assert.equal(failure.effect, 'die');
  assert.equal(failure.state.pose, 'dying');
  assert.equal(failure.state.visible, true);
  const settled = settleTurnOutcome(failure.state, 'generation-1-failure');
  assert.equal(settled.pose, 'dead');
  assert.equal(settled.visible, false);
  assert.equal(settled.pendingDeathToken, null);
  assert.equal(initial.pose, 'awake');
  assert.equal(failure.state.pose, 'dying');
});

test('interruption sleeps in the office and new work wakes it', () => {
  const interrupted = presentTurnOutcome(createOutcomePresentation(), live('interrupted', 'sleep'));
  assert.equal(interrupted.state.pose, 'sleeping');
  assert.equal(interrupted.state.visible, true);
  assert.equal(interrupted.effect, 'sleep');
  const restart = presentTurnOutcome(interrupted.state, live('started', 'restart'));
  assert.equal(restart.state.pose, 'awake');
  assert.equal(restart.state.visible, true);
  assert.equal(restart.effect, 'wake');
});

test('new work returns after death or an exit with an arrival intent', () => {
  for (const previous of [createOutcomePresentation('dead'), createOutcomePresentation('awake', false)]) {
    const result = presentTurnOutcome(previous, live('started', 'return'));
    assert.equal(result.state.pose, 'awake');
    assert.equal(result.state.visible, true);
    assert.equal(result.effect, 'arrive');
  }
});

test('historical outcome baselines establish poses without replaying animations', () => {
  const expected = {
    started: { pose: 'awake', visible: true },
    succeeded: { pose: 'awake', visible: true },
    failed: { pose: 'dead', visible: false },
    interrupted: { pose: 'sleeping', visible: true },
  } as const;
  for (const status of ['started', 'succeeded', 'failed', 'interrupted'] as const) {
    const result = presentTurnOutcome(createOutcomePresentation(), { status, token: status, mode: 'baseline' });
    assert.equal(result.effect, null);
    assert.equal(result.state.pose, expected[status].pose);
    assert.equal(result.state.visible, expected[status].visible);
    assert.equal(result.state.pendingDeathToken, null);
  }
});

test('duplicate failure observations never replay death before or after settlement', () => {
  const observation = live('failed', 'once');
  const dying = presentTurnOutcome(createOutcomePresentation(), observation).state;
  const dead = settleTurnOutcome(dying, 'once');
  for (const state of [dying, dead]) {
    const duplicate = presentTurnOutcome(state, observation);
    assert.equal(duplicate.state, state);
    assert.equal(duplicate.effect, null);
  }
});

test('late death completion cannot hide a restarted or sleeping sprite', () => {
  const dying = presentTurnOutcome(createOutcomePresentation(), live('failed', 'old-death')).state;
  for (const nextStatus of ['started', 'interrupted', 'succeeded'] as const) {
    const current = presentTurnOutcome(dying, live(nextStatus, 'new-' + nextStatus)).state;
    assert.equal(settleTurnOutcome(current, 'old-death'), current);
    assert.equal(current.visible, true);
    assert.equal(current.pendingDeathToken, null);
  }
  assert.equal(settleTurnOutcome(dying, 'another-generation'), dying);
});

test('a reconnect baseline settles the outcome and invalidates in-flight death callbacks', () => {
  const dying = presentTurnOutcome(createOutcomePresentation(), live('failed', 'before-reconnect')).state;
  const baseline = presentTurnOutcome(dying, {
    status: 'failed', token: 'before-reconnect', mode: 'baseline',
  });
  assert.equal(baseline.effect, null);
  assert.equal(baseline.state.pose, 'dead');
  assert.equal(settleTurnOutcome(baseline.state, 'before-reconnect'), baseline.state);
});

test('unknown and disconnected metadata do not invent outcomes or animation intents', () => {
  for (const state of [createOutcomePresentation(), createOutcomePresentation('sleeping')]) {
    for (const status of ['unknown', 'disconnected'] as const) {
      const result = presentTurnOutcome(state, { status, token: 'metadata', mode: 'live' });
      assert.equal(result.state, state);
      assert.equal(result.effect, null);
    }
  }
});

test('successful movement remains controlled by the office lifecycle controller', () => {
  for (const visible of [true, false]) {
    const result = presentTurnOutcome(createOutcomePresentation('awake', visible), live('succeeded', 'success'));
    assert.equal(result.state.visible, visible);
    assert.equal(result.state.pose, 'awake');
    assert.equal(result.effect, null);
  }
});
