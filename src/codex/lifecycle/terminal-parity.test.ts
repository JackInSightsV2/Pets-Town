import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot } from '../../client/test-helpers.js';
import { createOfficeStore } from '../../client/store.js';
import { isOfficeEvent, isOfficeSnapshot } from '../../client/validation.js';
import type { OfficeAdapter } from '../../server/adapter.js';
import { validEvent } from '../../server/validation.js';
import { createTurnLifecycleController } from '../../office/lifecycle/controller.js';
import type { TurnLifecycleStatus } from '../../shared/turn-lifecycle.js';
import { RolloutLifecycleReader, type RolloutLifecycleScan } from './rollout-reader.js';
import { createWindowsTurnLifecycleAdapter } from './windows-adapter.js';

const at = '2026-01-01T00:01:00.000Z';
const startedAt = 1767225610;
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) assert.fail('Synthetic rollout scan did not complete.'); await pause(); }
}

async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'turn-terminal-parity-'));
  const path = join(dir, 'synthetic.jsonl');
  const adapters: OfficeAdapter[] = [];
  const readers: RolloutLifecycleReader[] = [];
  t.after(async () => {
    await Promise.all(adapters.map(adapter => adapter.stop()));
    readers.forEach(reader => reader.close());
    await rm(dir, { recursive: true, force: true });
  });
  let ordinal = 0;
  const line = (type: string, payload: unknown) => JSON.stringify({ ordinal: ordinal++, timestamp: at, type, payload }) + '\n';
  await writeFile(path, line('session_meta', { id: 'main', cwd: dir, cli_version: '0.166.0-alpha.5.1', source: 'vscode' }));
  const makeReader = () => {
    const reader = new RolloutLifecycleReader({ paths: [path], allowedCwds: [dir],
      sourceNamespace: 'synthetic-terminal-parity', now: () => at });
    readers.push(reader);
    return reader;
  };
  async function chain(reader: RolloutLifecycleReader) {
    const initial = { ...snapshot(), source: 'codex' as const };
    const base: OfficeAdapter = { initialSnapshot: () => structuredClone(initial), subscribe: () => () => {}, stop() {} };
    let scans = 0;
    let source: RolloutLifecycleScan = { observations: [], latestTurns: [], quarantined: 0 };
    const adapter = await createWindowsTurnLifecycleAdapter({ base, pollMs: 10, now: () => at,
      reader: { async scan() { source = await reader.scan(); scans++; return source; }, close: () => reader.close() },
    });
    adapters.push(adapter);
    const wireSnapshot: unknown = JSON.parse(JSON.stringify(await adapter.initialSnapshot()));
    assert.ok(isOfficeSnapshot(wireSnapshot));
    const store = createOfficeStore(wireSnapshot);
    const lifecycle = createTurnLifecycleController();
    const generation = lifecycle.baseline({ agents: wireSnapshot.agents, latestTurns: wireSnapshot.latestTurns ?? [],
      connected: true, presentation: 'live' });
    assert.deepEqual(lifecycle.drainEffects(), [], 'bootstrap must never replay terminal animations');
    let deliveryError: unknown;
    adapter.subscribe(input => {
      try {
        const wire: unknown = JSON.parse(JSON.stringify(input));
        assert.ok(validEvent(wire));
        assert.ok(isOfficeEvent(wire));
        store.applyEvent(wire);
        assert.equal(store.getState().error, null);
        if (wire.type === 'agent.turn.observed') lifecycle.observe(wire.data.observation, generation);
        for (const effect of lifecycle.drainEffects()) assert.equal(lifecycle.complete(effect.token), true);
      } catch (error) { deliveryError = error; }
    });
    const checkDelivery = () => { if (deliveryError) throw deliveryError; };
    return { adapter, store, lifecycle, source: () => source, scans: () => scans, checkDelivery };
  }
  const live = await chain(makeReader());
  async function append(payload: Record<string, unknown>) {
    await appendFile(path, line('event_msg', { turn_id: 'synthetic-turn', started_at: startedAt, ...payload }));
    const before = live.scans();
    // A poll already in flight may have captured EOF before appendFile finished.
    // Two serial completions guarantee one scan began after the durable append.
    await until(() => live.scans() >= before + 2);
    live.checkDelivery();
    assert.equal(live.source().quarantined, 0);
  }
  const sprite = (value: ReturnType<typeof createTurnLifecycleController>) => {
    const { turnId, status, phase, pose, visible } = value.getState()[0];
    return { turnId, status, phase, pose, visible };
  };
  function assertLive(status: TurnLifecycleStatus) {
    live.checkDelivery();
    assert.equal(live.source().latestTurns[0]?.status, status, 'source latest agrees with the first authoritative terminal');
    assert.equal(live.store.getState().snapshot?.latestTurns?.[0]?.status, status, 'live wire/store retains the same outcome');
    assert.equal(live.lifecycle.getState()[0].status, status);
  }
  async function assertFreshParity(status: TurnLifecycleStatus) {
    assertLive(status);
    const fresh = await chain(makeReader());
    assert.equal(fresh.source().latestTurns[0]?.status, status, 'fresh source bootstrap matches live source truth');
    assert.equal(fresh.store.getState().snapshot?.latestTurns?.[0]?.status, status, 'fresh wire bootstrap matches the live outcome');
    assert.deepEqual(sprite(fresh.lifecycle), sprite(live.lifecycle), 'fresh and settled live sprite presentation agree');
    assert.equal(live.store.getState().snapshot?.agents[0].runtimeState, 'working', 'presentation does not close the runtime');
    await fresh.adapter.stop();
  }
  return { live, append, assertLive, assertFreshParity };
}

test('live and fresh bootstrap retain interruption after abort, late error and completion', async t => {
  const h = await fixture(t);
  await h.append({ type: 'task_started' });
  h.assertLive('started');
  await h.append({ type: 'turn_aborted', reason: 'interrupted', completed_at: startedAt + 1 });
  h.assertLive('interrupted');
  await h.append({ type: 'error', message: 'SYNTHETIC private detail', codex_error_info: 'other' });
  h.assertLive('interrupted');
  await h.append({ type: 'task_complete', completed_at: startedAt + 2 });
  await h.assertFreshParity('interrupted');
  assert.equal(h.live.lifecycle.getState()[0].pose, 'sleeping');
  assert.equal(h.live.lifecycle.getState()[0].visible, true);
});

test('live and fresh bootstrap retain failure after error, failed completion and late abort', async t => {
  const h = await fixture(t);
  await h.append({ type: 'task_started' });
  await h.append({ type: 'error', message: 'SYNTHETIC private detail', codex_error_info: 'other' });
  assert.equal(h.live.store.getState().snapshot?.latestTurns?.[0].status, 'started', 'error flag alone is not terminal');
  await h.append({ type: 'task_complete', completed_at: startedAt + 1 });
  h.assertLive('failed');
  await h.append({ type: 'turn_aborted', reason: 'interrupted', completed_at: startedAt + 2 });
  await h.assertFreshParity('failed');
  assert.equal(h.live.lifecycle.getState()[0].pose, 'dead');
  assert.equal(h.live.lifecycle.getState()[0].visible, false);
});

test('preterminal error followed by abort is interruption in both live and fresh presentation', async t => {
  const h = await fixture(t);
  await h.append({ type: 'task_started' });
  await h.append({ type: 'error', message: 'SYNTHETIC private detail', codex_error_info: 'other' });
  assert.equal(h.live.store.getState().snapshot?.latestTurns?.[0].status, 'started');
  assert.equal(h.live.lifecycle.getState()[0].phase, 'present');
  assert.equal(h.live.lifecycle.getState()[0].visible, true);
  await h.append({ type: 'turn_aborted', reason: 'interrupted', completed_at: startedAt + 1 });
  await h.assertFreshParity('interrupted');
  assert.equal(h.live.lifecycle.getState()[0].pose, 'sleeping');
});
