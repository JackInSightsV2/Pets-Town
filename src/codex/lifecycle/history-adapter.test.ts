import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAdapter } from '../../server/adapter.js';
import { emptySnapshot, type OfficeAgent, type OfficeEvent } from '../../shared/contract.js';
import type { VerifiedHistoryReader } from '../handoffs/history-adapter.js';
import { createTurnLifecycleController } from '../../office/lifecycle/controller.js';
import { createTurnLifecycleHistoryAdapter } from './history-adapter.js';

const at = '2026-11-01T16:00:00Z';
const delay = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Synthetic observation did not arrive.');
    await delay();
  }
}
const agent = (agentId: string, runtimeState: OfficeAgent['runtimeState'] = 'working'): OfficeAgent => ({
  agentId, parentAgentId: null, projectId: 'synthetic-project', displayName: 'Synthetic colleague',
  role: null, task: null, runtimeState, activityKind: 'unknown', lastObservedAt: at,
  pendingRequestIds: [], petAssetId: null, recentActivity: [],
});
const turn = (id: string, status: string, startedAt = 100) => ({
  id, status, startedAt, completedAt: status === 'inProgress' ? null : startedAt + 1,
  error: status === 'failed' ? { message: 'PRIVATE-SYNTHETIC-ERROR' } : null,
  items: [{ text: 'PRIVATE-SYNTHETIC-TRANSCRIPT' }],
});
function harness() {
  const snapshot = emptySnapshot('synthetic-base');
  snapshot.agents = [agent('synthetic-agent')];
  snapshot.connection = { status: 'connected', lastObservedAt: at, message: null };
  const responses = new Map<string, unknown>();
  const events: OfficeEvent[] = [];
  const failures = new Set<string>();
  let sink: (event: OfficeEvent) => void = () => {};
  let generation = 'synthetic-generation-1', baseSeq = 0, reads = 0, closed = 0, baseStops = 0;
  const set = (id: string, turns: unknown[], status: unknown = { type: 'active' }) => {
    responses.set(id, { thread: { id, turns, status } });
  };
  set('synthetic-agent', [turn('synthetic-turn-1', 'completed')]);
  const base: OfficeAdapter = {
    initialSnapshot: () => structuredClone(snapshot),
    subscribe(fn) { sink = fn; return () => { sink = () => {}; }; },
    stop() { baseStops++; },
  };
  const reader: VerifiedHistoryReader = {
    get generation() { return generation; },
    async read(id) {
      reads++;
      if (failures.has(id)) throw new Error('Synthetic unavailable read.');
      return structuredClone(responses.get(id) ?? { thread: { id, turns: [], status: { type: 'idle' } } });
    },
    close() { closed++; },
  };
  const emit = (event: Omit<OfficeEvent, 'protocolVersion' | 'bridgeEpoch' | 'seq' | 'eventId' | 'occurredAt' | 'source'>, skip = 0) => {
    baseSeq += 1 + skip;
    sink({ ...event, protocolVersion: 1, bridgeEpoch: 'synthetic-base', seq: baseSeq,
      eventId: `synthetic-base-event-${baseSeq}`, occurredAt: at, source: 'codex' } as OfficeEvent);
  };
  return { snapshot, base, reader, responses, events, failures, set, emit,
    reads: () => reads, closes: () => closed, stops: () => baseStops,
    reconnect() { generation += '-next'; },
    lifecycle: () => events.filter(e => e.type === 'agent.turn.observed'),
  };
}
async function setup(h: ReturnType<typeof harness>, sourceVerified = true) {
  const adapter = await createTurnLifecycleHistoryAdapter({ base: h.base, reader: h.reader,
    sourceNamespace: 'synthetic-runtime', sourceVerified, pollMs: 10, now: () => at });
  adapter.subscribe(event => h.events.push(event));
  return adapter;
}

test('initial latest terminal is silent and strips transcript/error details', async t => {
  const h = harness();
  h.set('synthetic-agent', [turn('old', 'failed', 1), turn('latest', 'completed', 10)]);
  const adapter = await setup(h); t.after(() => adapter.stop());
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.lastSeq, 0);
  assert.equal(snapshot.latestTurns?.length, 1);
  assert.equal(snapshot.latestTurns?.[0].status, 'succeeded');
  assert.equal(snapshot.latestTurns?.[0].delivery, 'history');
  assert.equal(snapshot.latestTurns?.[0].startedAt, 10);
  assert.doesNotMatch(JSON.stringify(snapshot.latestTurns), /PRIVATE-SYNTHETIC|"latest"|"old"/);
  await delay(40);
  assert.equal(h.lifecycle().length, 0);
});

test('initial terminal without start time cannot poison a later verified live start', async t => {
  const h = harness();
  h.set('synthetic-agent', [{ ...turn('unordered-terminal', 'completed'), startedAt: null }]);
  const adapter = await setup(h); t.after(() => adapter.stop());
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.latestTurns, undefined);
  const controller = createTurnLifecycleController();
  const generation = controller.baseline({ agents: snapshot.agents, latestTurns: snapshot.latestTurns ?? [],
    connected: true, presentation: 'live' });
  h.set('synthetic-agent', [turn('verified-next-turn', 'inProgress', 200)]);
  await until(() => h.lifecycle().length === 1);
  const observation = h.lifecycle()[0].data.observation;
  assert.equal(observation.delivery, 'live');
  assert.equal(observation.status, 'started');
  assert.equal(controller.observe(observation, generation), 'applied');
  assert.equal(controller.getState()[0].phase, 'entering');
  assert.equal(controller.getState()[0].visible, true);
  assert.equal(controller.drainEffects()[0].type, 'enter');
  assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].startedAt, 200);
});

test('same-turn terminal without start time retains the known start and permits later turns', async t => {
  const h = harness(); h.set('synthetic-agent', [turn('known-turn', 'inProgress', 100)]);
  const adapter = await setup(h); t.after(() => adapter.stop());
  h.set('synthetic-agent', [{ ...turn('known-turn', 'completed', 100), startedAt: null }]);
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.status, 'succeeded');
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'live');
  const terminal = (await adapter.initialSnapshot()).latestTurns?.[0];
  assert.equal(terminal?.startedAt, 100);
  assert.equal(terminal?.status, 'succeeded');
  h.set('synthetic-agent', [turn('newer-turn', 'inProgress', 200)]);
  await until(() => h.lifecycle().length === 2);
  assert.equal(h.lifecycle()[1].data.observation.delivery, 'live');
  assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].startedAt, 200);
});

test('verified source changes emit one live start/success/failure/interruption each', async t => {
  const h = harness(); const adapter = await setup(h); t.after(() => adapter.stop());
  const phases = [
    ['turn-2', 'inProgress', 200, 'started'], ['turn-2', 'completed', 200, 'succeeded'],
    ['turn-3', 'inProgress', 300, 'started'], ['turn-3', 'failed', 300, 'failed'],
    ['turn-4', 'inProgress', 400, 'started'], ['turn-4', 'interrupted', 400, 'interrupted'],
  ] as const;
  for (const [index, [id, status, start, expected]] of phases.entries()) {
    h.set('synthetic-agent', [turn(id, status, start)]);
    await until(() => h.lifecycle().length === index + 1);
    const event = h.lifecycle()[index];
    assert.equal(event.data.observation.status, expected);
    assert.equal(event.data.observation.delivery, 'live');
    assert.equal(event.seq, index + 1);
  }
  await delay(40);
  assert.equal(h.lifecycle().length, phases.length);
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.lastSeq, phases.length);
  assert.equal(snapshot.latestTurns?.[0].status, 'interrupted');
  assert.equal(snapshot.agents[0].runtimeState, 'working');
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE-SYNTHETIC/);
});

test('all scoped roster states are scanned, including metadata unknown and error', async t => {
  const h = harness();
  h.snapshot.agents = [agent('unknown-agent', 'unknown'), agent('error-agent', 'error')];
  h.set('unknown-agent', [turn('unknown-turn', 'interrupted')]);
  h.set('error-agent', [turn('error-turn', 'failed')]);
  const adapter = await setup(h); t.after(() => adapter.stop());
  const snapshot = await adapter.initialSnapshot();
  assert.deepEqual(snapshot.latestTurns?.map(row => row.status).sort(), ['failed', 'interrupted']);
  assert.deepEqual(snapshot.agents.map(row => row.runtimeState), ['unknown', 'error']);
});

test('unsupported final turn never falls back to older terminal and recovery is history', async t => {
  const h = harness(); const adapter = await setup(h); t.after(() => adapter.stop());
  const known = (await adapter.initialSnapshot()).latestTurns;
  const before = h.reads();
  h.set('synthetic-agent', [turn('earlier', 'completed', 150), { id: 'implicit-latest', status: 'completed' }]);
  await until(() => h.reads() > before);
  assert.deepEqual((await adapter.initialSnapshot()).latestTurns, known);
  assert.equal(h.lifecycle().length, 0);
  h.set('synthetic-agent', [turn('new-active', 'inProgress', 200)]);
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.status, 'started');
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
});

test('inProgress requires exact active thread status and a correlated thread response', async t => {
  const h = harness();
  h.set('synthetic-agent', [turn('turn', 'inProgress')], 'active');
  const adapter = await setup(h); t.after(() => adapter.stop());
  assert.equal((await adapter.initialSnapshot()).latestTurns, undefined);
  h.responses.set('synthetic-agent', { thread: { id: 'wrong-agent', status: { type: 'active' }, turns: [turn('turn', 'inProgress')] } });
  const before = h.reads(); await until(() => h.reads() > before);
  assert.equal(h.lifecycle().length, 0);
  h.set('synthetic-agent', [turn('turn', 'inProgress')]);
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
});

test('late discovery and missed whole turns are settled history, never fake live exits', async t => {
  const h = harness(); h.snapshot.agents = [];
  const adapter = await setup(h); t.after(() => adapter.stop());
  h.emit({ type: 'agent.upserted', agentId: 'synthetic-agent', data: { agent: agent('synthetic-agent') } });
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
  h.set('synthetic-agent', [turn('finished-between-polls', 'completed', 200)]);
  await until(() => h.lifecycle().length === 2);
  assert.equal(h.lifecycle()[1].data.observation.delivery, 'history');
  assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].startedAt, 200);
});

test('reader reconnect publishes a silent baseline even for the same source observation', async t => {
  const h = harness(); const adapter = await setup(h); t.after(() => adapter.stop());
  h.set('synthetic-agent', [turn('next', 'inProgress', 200)]);
  await until(() => h.lifecycle().length === 1);
  h.reconnect();
  await until(() => h.lifecycle().length === 2);
  const [live, baseline] = h.lifecycle();
  assert.equal(live.data.observation.delivery, 'live');
  assert.equal(baseline.data.observation.delivery, 'history');
  assert.equal(baseline.data.observation.sourceEventId, live.data.observation.sourceEventId);
  assert.notEqual(baseline.eventId, live.eventId);
  h.set('synthetic-agent', [turn('next', 'completed', 200)]);
  await until(() => h.lifecycle().length === 3);
  assert.equal(h.lifecycle()[2].data.observation.delivery, 'live');
});

test('optional read failure leaves metadata healthy and recovery is a new baseline', async t => {
  const h = harness(); const adapter = await setup(h); t.after(() => adapter.stop());
  h.failures.add('synthetic-agent');
  const before = h.reads(); await until(() => h.reads() > before);
  assert.equal((await adapter.initialSnapshot()).connection.status, 'connected');
  h.set('synthetic-agent', [turn('during-gap', 'inProgress', 200)]);
  h.failures.clear();
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
});

test('lost known history invalidates continuity while an empty startup permits a live first start', async t => {
  const h = harness(); h.set('synthetic-agent', []);
  const adapter = await setup(h); t.after(() => adapter.stop());
  h.set('synthetic-agent', [turn('first', 'inProgress', 200)]);
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'live');
  h.set('synthetic-agent', []);
  const before = h.reads(); await until(() => h.reads() > before);
  h.set('synthetic-agent', [turn('recovered', 'inProgress', 300)]);
  await until(() => h.lifecycle().length === 2);
  assert.equal(h.lifecycle()[1].data.observation.delivery, 'history');
});

test('a response from an old reader generation cannot establish a live outcome', async t => {
  const h = harness();
  let holdNext = false, blocked = false;
  let release: (() => void) | undefined;
  const reader: VerifiedHistoryReader = {
    get generation() { return h.reader.generation; },
    async read(id) {
      const captured = await h.reader.read(id);
      if (holdNext) {
        holdNext = false;
        blocked = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      return captured;
    },
    close: () => h.reader.close(),
  };
  const adapter = await createTurnLifecycleHistoryAdapter({ base: h.base, reader,
    sourceNamespace: 'synthetic-runtime', sourceVerified: true, pollMs: 10, now: () => at });
  t.after(() => adapter.stop());
  adapter.subscribe(event => h.events.push(event));
  h.set('synthetic-agent', [turn('stale-response', 'inProgress', 200)]);
  holdNext = true;
  await until(() => blocked);
  h.reconnect();
  h.set('synthetic-agent', [turn('current-response', 'interrupted', 300)]);
  release!();
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.status, 'interrupted');
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
  assert.equal(h.lifecycle()[0].data.observation.startedAt, 300);
  assert.equal(h.lifecycle().some(event => event.data.observation.startedAt === 200), false);
});

test('unverified sources do not read history or emit lifecycle', async t => {
  const h = harness(); const adapter = await setup(h, false); t.after(() => adapter.stop());
  await delay(40);
  assert.equal(h.reads(), 0);
  assert.equal(h.events.length, 0);
  assert.equal((await adapter.initialSnapshot()).latestTurns, undefined);
});

test('metadata connection gaps rebaseline, while sequence loss fails closed', async t => {
  const h = harness(); const adapter = await setup(h); t.after(() => adapter.stop());
  h.emit({ type: 'connection.changed', agentId: null, data: { connection: { status: 'reconnecting', lastObservedAt: at, message: null } } });
  h.set('synthetic-agent', [turn('during-disconnect', 'inProgress', 200)]);
  await delay(30);
  assert.equal(h.lifecycle().length, 0);
  h.emit({ type: 'connection.changed', agentId: null, data: { connection: { status: 'connected', lastObservedAt: at, message: null } } });
  await until(() => h.lifecycle().length === 1);
  assert.equal(h.lifecycle()[0].data.observation.delivery, 'history');
  h.emit({ type: 'agent.state.changed', agentId: 'synthetic-agent', data: { runtimeState: 'error' } }, 1);
  const count = h.events.length;
  assert.equal((await adapter.initialSnapshot()).connection.status, 'disconnected');
  h.set('synthetic-agent', [turn('during-disconnect', 'failed', 200)]);
  await delay(40);
  assert.equal(h.events.length, count);
  assert.equal((await adapter.initialSnapshot()).agents[0].runtimeState, 'working');
  assert.deepEqual(h.events.map(event => event.seq), h.events.map((_, i) => i + 1));
});

test('snapshot retains request attention and stop closes owned resources exactly once', async () => {
  const h = harness(); const adapter = await setup(h);
  h.emit({ type: 'request.opened', agentId: 'synthetic-agent', data: { request: {
    requestId: 'synthetic-request', agentId: 'synthetic-agent', kind: 'user-input', prompt: null,
    options: [], createdAt: at, responseCapability: { supported: false, reason: null }, revision: null,
  } } });
  h.emit({ type: 'agent.upserted', agentId: 'synthetic-agent', data: { agent: agent('synthetic-agent') } });
  assert.deepEqual((await adapter.initialSnapshot()).agents[0].pendingRequestIds, ['synthetic-request']);
  await adapter.stop(); await adapter.stop();
  assert.equal(h.closes(), 1);
  assert.equal(h.stops(), 1);
  const reads = h.reads(); await delay(30);
  assert.equal(h.reads(), reads);
});
