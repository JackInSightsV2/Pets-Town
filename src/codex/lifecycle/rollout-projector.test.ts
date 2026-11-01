import test from 'node:test';
import assert from 'node:assert/strict';
import { createRolloutLifecycleProjector, projectRolloutLifecycleRecord } from './rollout-projector.js';
import type { TurnLifecycleResult } from './normalizer.js';

const at = '2026-01-01T00:00:00.000Z';
const live = { delivery: 'live' as const, observedAt: at };
const history = { delivery: 'history' as const, observedAt: at };
const options = { source: 'fixture' as const, sourceNamespace: 'synthetic-source', threadId: 'synthetic-thread', agentId: 'agent-a' };
const make = (maxTurns?: number) => createRolloutLifecycleProjector({ ...options, ...(maxTurns === undefined ? {} : { maxTurns }) });
const event = (type: string, extra: Record<string, unknown> = {}) => ({ type: 'event_msg', payload: { type, ...extra } });
const start = (id = 'turn-a', extra: Record<string, unknown> = {}) => event('task_started', { turn_id: id, ...extra });
const complete = (id = 'turn-a', extra: Record<string, unknown> = {}) => event('task_complete', { turn_id: id, ...extra });
const abort = (id = 'turn-a', extra: Record<string, unknown> = {}) => event('turn_aborted', { turn_id: id, reason: 'interrupted', ...extra });
function observed(result: TurnLifecycleResult, status: string, delivery?: string) {
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') throw new Error('Expected lifecycle observation.');
  assert.equal(result.observation.status, status);
  if (delivery) assert.equal(result.observation.delivery, delivery);
  return result.observation;
}

test('fully correlated start and completion establish one observation per source transition', () => {
  const projector = make();
  const started = observed(projector.observe(start('turn-a', { started_at: 100 }), live), 'started', 'live');
  const ended = observed(projector.observe(complete('turn-a', { completed_at: 101 }), live), 'succeeded', 'live');
  assert.equal(started.turnId, ended.turnId);
  assert.notEqual(started.sourceEventId, ended.sourceEventId);
  assert.notEqual(projector.observe(complete(), live).kind, 'observed');
  assert.notEqual(projector.observe(start('turn-a', { started_at: 100 }), live).kind, 'observed');
  observed(projector.latest({ observedAt: at }), 'succeeded', 'history');
});

test('canonical names and supported aliases share identity and do not replay', () => {
  const projector = make();
  observed(projector.observe(event('turn_started', { turn_id: 'turn-a' }), live), 'started');
  assert.notEqual(projector.observe(start(), live).kind, 'observed');
  observed(projector.observe(event('turn_complete', { turn_id: 'turn-a' }), live), 'succeeded');
  assert.notEqual(projector.observe(complete(), live).kind, 'observed');
});

test('initial unfinished history does not claim activity; explicit historical terminal is silent evidence', () => {
  const projector = make();
  assert.equal(projector.observe(start(), history).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: at, currentThreadActive: false }).kind, 'unavailable');
  observed(projector.latest({ observedAt: at, currentThreadActive: true }), 'started', 'history');
  observed(projector.observe(complete(), history), 'succeeded', 'history');
  observed(projector.latest({ observedAt: at }), 'succeeded', 'history');
});

test('observed live start can seed reconnect presence without replaying arrival', () => {
  const projector = make();
  observed(projector.observe(start(), live), 'started', 'live');
  observed(projector.latest({ observedAt: at, currentThreadActive: false }), 'started', 'history');
  const reconnected = make();
  reconnected.observe(start(), history);
  assert.equal(reconnected.latest({ observedAt: at }).kind, 'unavailable');
});

test('an error is carried to terminal completion instead of being overwritten as success', () => {
  for (const codex_error_info of [undefined, null, 'rate_limit_exceeded', { http_connection_failed: { http_status_code: 503 } }]) {
    const projector = make();
    projector.observe(start(), live);
    assert.notEqual(projector.observe(event('error', { message: 'synthetic-private-error', codex_error_info }), live).kind, 'observed');
    assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
    observed(projector.observe(complete(), live), 'failed');
    observed(projector.latest({ observedAt: at }), 'failed', 'history');
  }
});

test('non-turn errors, warnings, stream errors and failed tools do not create a turn failure', () => {
  const projector = make();
  projector.observe(start(), live);
  for (const value of [
    event('error', { message: 'synthetic', codex_error_info: 'thread_rollback_failed' }),
    event('error', { message: 'synthetic', codex_error_info: { active_turn_not_steerable: { turn_kind: 'review' } } }),
    event('warning', { message: 'synthetic' }), event('stream_error', { message: 'synthetic' }),
    event('exec_command_end', { exit_code: 1 }), event('request_user_input', { questions: ['synthetic-private'] }),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'synthetic-private' } },
  ]) assert.notEqual(projector.observe(value, live).kind, 'observed');
  observed(projector.observe(complete(), live), 'succeeded');
});

test('abort and completion preserve source outcome precedence', () => {
  for (const reason of ['interrupted', 'replaced', 'review_ended', 'budget_limited']) {
    const projector = make();
    projector.observe(start(), history);
    projector.observe(event('error', { message: 'synthetic' }), history);
    observed(projector.observe(abort('turn-a', { reason, error: { message: 'synthetic' } }), history), 'interrupted', 'history');
    assert.notEqual(projector.observe(complete(), live).kind, 'observed');
    observed(projector.latest({ observedAt: at }), 'interrupted');
    observed(projector.observe(complete('turn-a', { error: { message: 'synthetic-terminal' } }), live), 'failed');
    observed(projector.latest({ observedAt: at }), 'failed');
  }
});

test('terminal error is failed even when its category would be nonterminal as a standalone error', () => {
  const projector = make();
  projector.observe(start(), live);
  observed(projector.observe(complete('turn-a', { error: { message: 'synthetic', codex_error_info: 'thread_rollback_failed' } }), live), 'failed');
});

test('error after abort still belongs to that source-current turn until completion', () => {
  const projector = make();
  projector.observe(start(), live);
  observed(projector.observe(abort(), live), 'interrupted');
  assert.notEqual(projector.observe(event('error', { message: 'synthetic' }), live).kind, 'observed');
  assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
  observed(projector.observe(complete(), live), 'failed');
});

test('uncorrelated completion and missing abort IDs never manufacture a latest outcome', () => {
  for (const terminal of [complete('unknown'), event('task_complete'), event('turn_aborted', { reason: 'interrupted' })]) {
    const projector = make();
    projector.observe(start(), live);
    assert.equal(projector.observe(terminal, live).kind, 'unavailable');
    assert.equal(projector.observe(complete(), live).kind, 'unavailable');
    assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
    observed(projector.observe(start('fresh'), live), 'started');
    observed(projector.observe(complete('fresh'), live), 'succeeded');
  }
  const projector = make();
  assert.equal(projector.observe(complete(), history).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
});

test('unknown error variants and malformed lifecycle fields block success until a new explicit start', () => {
  for (const invalid of [
    event('error', { message: 'synthetic', codex_error_info: 'future-code' }),
    event('error', { message: 'synthetic', codex_error_info: { active_turn_not_steerable: { turn_kind: 'future' } } }),
    complete('turn-a', { error: 'synthetic-malformed' }), abort('turn-a', { reason: 'future-reason' }),
    complete('turn-a', { completed_at: 100.5 }), complete('turn-a', { started_at: 99 }), complete('turn-a', { completed_at: 99 }),
  ]) {
    const projector = make();
    projector.observe(start('turn-a', { started_at: 100 }), live);
    assert.equal(projector.observe(invalid, live).kind, 'unavailable');
    assert.equal(projector.observe(complete(), live).kind, 'unavailable');
  }
});

test('late completion for an older turn never replaces the latest source-started turn', () => {
  const projector = make();
  projector.observe(start('old', { started_at: 100 }), history);
  const current = observed(projector.observe(start('new', { started_at: 101 }), live), 'started');
  observed(projector.observe(complete('old', { completed_at: 102 }), live), 'succeeded');
  const latest = observed(projector.latest({ observedAt: at }), 'started', 'history');
  assert.equal(latest.turnId, current.turnId);
  assert.notEqual(projector.observe(start('old', { started_at: 100 }), live).kind, 'observed');
  assert.equal(observed(projector.latest({ observedAt: at }), 'started').turnId, current.turnId);
});

test('staged clone can be committed or discarded without leaking a failed transaction', () => {
  const original = make();
  original.observe(start(), live);
  const staged = original.clone();
  observed(staged.observe(complete(), live), 'succeeded');
  observed(original.latest({ observedAt: at }), 'started');
  observed(staged.latest({ observedAt: at }), 'succeeded');
  observed(original.observe(complete(), live), 'succeeded');
});

test('source rollback invalidates a terminal baseline until a new explicit turn', () => {
  const projector = make();
  projector.observe(start(), history); projector.observe(complete(), history);
  observed(projector.latest({ observedAt: at }), 'succeeded');
  assert.equal(projector.observe(event('thread_rolled_back', { num_turns: 1 }), live).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
  observed(projector.observe(start('after-rollback'), live), 'started');
  observed(projector.latest({ observedAt: at }), 'started');
});

test('fixed projection strips private fields before staging and public observations use opaque correlations', () => {
  const raw = { timestamp: at, ordinal: 12, ...start('synthetic-private-turn', { started_at: 100, prompt: 'synthetic-private-prompt', cwd: 'synthetic-private-path' }) };
  const fixed = projectRolloutLifecycleRecord(raw)!;
  assert.deepEqual(fixed, { projection: 'rollout-lifecycle-v1', ordinal: 12, kind: 'started', turnId: 'synthetic-private-turn', startedAt: 100, recordedAt: at });
  const error = projectRolloutLifecycleRecord(event('error', { message: 'synthetic-private-error', codex_error_info: 'rate_limit_exceeded' }));
  assert.deepEqual(error, { projection: 'rollout-lifecycle-v1', ordinal: null, kind: 'error', affectsTurn: true });
  const projector = make();
  const result = observed(projector.observe(fixed, live), 'started');
  assert.equal(projector.latestStart()?.ordinal, 12);
  for (const secret of ['synthetic-private-turn', 'synthetic-private-prompt', 'synthetic-private-path', 'synthetic-private-error', options.threadId, options.sourceNamespace]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('unsupported lifecycle projection retains only its ownership ordinal for reader filtering', () => {
  assert.deepEqual(projectRolloutLifecycleRecord({ ...event('turn_aborted', { reason: 'future', turn_id: 'synthetic-private-turn' }), ordinal: 3 }),
    { projection: 'rollout-lifecycle-v1', ordinal: 3, kind: 'invalid' });
});

test('fresh-file discovery can confirm an open seeded start exactly once after independent checks', () => {
  const projector = make();
  projector.observe({ ...start('turn-a', { started_at: 100 }), timestamp: at }, history);
  assert.equal(projector.latestStart()?.recordedAt, at);
  observed(projector.confirmLiveStart({ observedAt: at }), 'started', 'live');
  assert.notEqual(projector.confirmLiveStart({ observedAt: at }).kind, 'observed');
  observed(projector.latest({ observedAt: at }), 'started', 'history');
  projector.observe(complete(), history);
  assert.equal(projector.latestStart(), null);
  assert.equal(projector.confirmLiveStart({ observedAt: at }).kind, 'unavailable');
});

test('bounded identity retention fails closed instead of evicting and replaying old turns', () => {
  const projector = make(1);
  projector.observe(start(), history); projector.observe(complete(), history);
  assert.equal(projector.observe(start('second'), live).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: at }).kind, 'unavailable');
  assert.equal(projector.observe(start(), live).kind, 'unavailable');
  assert.equal(projector.clone().latest({ observedAt: at }).kind, 'unavailable');
  for (const maxTurns of [0, -1, 1.5, Infinity, 100_001]) assert.throws(() => make(maxTurns));
});

test('invalid context cannot mutate correlation or create an observation', () => {
  const projector = make();
  assert.equal(projector.observe(start(), { ...live, observedAt: 'invalid' }).kind, 'unavailable');
  assert.equal(projector.observe(complete(), live).kind, 'unavailable');
  assert.equal(projector.latest({ observedAt: 'invalid' }).kind, 'unavailable');
  assert.throws(() => createRolloutLifecycleProjector({ ...options, threadId: '' }));
});
