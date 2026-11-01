import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAdapter } from '../../server/adapter.js';
import { emptySnapshot, type OfficeAgent, type OfficeEvent } from '../../shared/contract.js';
import type { MacHistoryReader, MacHistoryReaderOptions } from '../handoffs/mac-history-reader.js';
import { createAdapter } from './mac-adapter.js';

const at = '2026-11-01T16:00:00Z';
const delay = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) assert.fail('Synthetic observation did not arrive.'); await delay(); }
}
const agent = (id: string, runtimeState: OfficeAgent['runtimeState']): OfficeAgent => ({
  agentId: id, parentAgentId: null, projectId: 'synthetic-project', displayName: 'Synthetic colleague',
  role: null, task: null, runtimeState, activityKind: 'reading', lastObservedAt: at,
  pendingRequestIds: [], petAssetId: null, recentActivity: [],
});
function harness() {
  const snapshot = emptySnapshot('synthetic-base');
  snapshot.connection = { status: 'connected', lastObservedAt: at, message: 'Synthetic base connected.' };
  snapshot.capabilities.observeHandoffs = { supported: true, reason: 'Synthetic verified base.' };
  snapshot.agents = [agent('unknown-row', 'unknown'), agent('error-row', 'error')];
  const listeners = new Set<(event: OfficeEvent) => void>();
  let stopped = 0, closed = 0, reads = 0;
  let allowed: (id: string) => boolean = () => false;
  let turnNumber = 1;
  const base: OfficeAdapter = {
    initialSnapshot: () => structuredClone(snapshot),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { stopped++; },
  };
  const createReader = async (options: MacHistoryReaderOptions): Promise<MacHistoryReader> => {
    allowed = options.isAllowed;
    return {
      version: '0.166.0', userAgent: 'codex/0.166.0 synthetic', generation: 'synthetic-generation',
      async read(id) {
        assert.equal(allowed(id), true);
        reads++;
        return { thread: { id, status: { type: 'active' }, turns: [{ id: 'synthetic-turn-' + turnNumber,
          status: 'inProgress', startedAt: turnNumber * 100, completedAt: null, error: null, items: [] }] } };
      },
      close() { closed++; },
    };
  };
  const emit = (event: Omit<OfficeEvent, 'protocolVersion' | 'bridgeEpoch' | 'seq' | 'eventId' | 'occurredAt' | 'source'>, skip = 0) => {
    snapshot.lastSeq += 1 + skip;
    const wrapped = { ...event, protocolVersion: 1, bridgeEpoch: snapshot.bridgeEpoch, seq: snapshot.lastSeq,
      eventId: 'synthetic-event-' + snapshot.lastSeq, occurredAt: at, source: 'codex' } as OfficeEvent;
    if (wrapped.type === 'connection.changed') snapshot.connection = wrapped.data.connection;
    if (wrapped.type === 'agent.upserted') snapshot.agents.push(wrapped.data.agent);
    for (const listener of [...listeners]) listener(wrapped);
  };
  return { snapshot, base, createReader, emit, allowed: (id: string) => allowed(id), reads: () => reads,
    stops: () => stopped, closes: () => closed, subscribers: () => listeners.size, advance() { turnNumber++; } };
}

test('Mac entrypoint preserves base features and allows every scoped roster state', async () => {
  const h = harness();
  h.snapshot.agents.push(agent('closed-row', 'closed'));
  const adapter = await createAdapter({ createBase: async () => h.base, createReader: h.createReader, pollMs: 10, now: () => at });
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.capabilities.observeHandoffs.supported, true);
  assert.equal(snapshot.latestTurns?.length, 3);
  assert.ok(snapshot.latestTurns?.every(row => row.delivery === 'history'));
  assert.deepEqual(snapshot.agents.map(row => row.activityKind), ['reading', 'reading', 'reading']);
  for (const id of ['unknown-row', 'error-row', 'closed-row']) assert.equal(h.allowed(id), true);
  assert.equal(h.allowed('unscoped-row'), false);
  await adapter.stop(); await adapter.stop();
  assert.equal(h.stops(), 1);
  assert.equal(h.closes(), 1);
  assert.equal(h.subscribers(), 0);
  assert.equal(h.allowed('unknown-row'), false);
});

test('disconnect gates reads and reconnect restores scoped rows with a silent baseline', async t => {
  const h = harness();
  const adapter = await createAdapter({ createBase: async () => h.base, createReader: h.createReader, pollMs: 10, now: () => at });
  t.after(() => adapter.stop());
  const events: OfficeEvent[] = []; adapter.subscribe(event => events.push(event));
  h.emit({ type: 'connection.changed', agentId: null, data: { connection: { status: 'reconnecting', lastObservedAt: at, message: null } } });
  assert.equal(h.allowed('unknown-row'), false);
  const reads = h.reads(); h.advance(); await delay(30);
  assert.equal(h.reads(), reads);
  h.emit({ type: 'agent.upserted', agentId: 'late-row', data: { agent: agent('late-row', 'unknown') } });
  assert.equal(h.allowed('late-row'), false);
  h.emit({ type: 'connection.changed', agentId: null, data: { connection: { status: 'connected', lastObservedAt: at, message: null } } });
  assert.equal(h.allowed('unknown-row'), true);
  assert.equal(h.allowed('error-row'), true);
  assert.equal(h.allowed('late-row'), true);
  await until(() => events.filter(event => event.type === 'agent.turn.observed').length === 3);
  assert.ok(events.filter(event => event.type === 'agent.turn.observed').every(event => event.data.observation.delivery === 'history'));
});

test('optional reader creation failure preserves the live base and idempotent cleanup', async () => {
  const h = harness();
  const adapter = await createAdapter({ createBase: async () => h.base,
    createReader: async () => { throw new Error('Synthetic optional reader unavailable.'); } });
  assert.equal(h.subscribers(), 0);
  assert.equal((await adapter.initialSnapshot()).connection.status, 'connected');
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported, true);
  let received = false;
  const unsubscribe = adapter.subscribe(() => { received = true; });
  h.emit({ type: 'agent.state.changed', agentId: 'unknown-row', data: { runtimeState: 'working' } });
  assert.equal(received, true);
  assert.equal(h.stops(), 0);
  unsubscribe(); await adapter.stop(); await adapter.stop();
  assert.equal(h.stops(), 1);
  assert.equal(h.closes(), 0);
});

test('scope event continuity loss immediately revokes optional read authorization', async t => {
  const h = harness();
  const adapter = await createAdapter({ createBase: async () => h.base, createReader: h.createReader, pollMs: 10, now: () => at });
  t.after(() => adapter.stop());
  h.emit({ type: 'agent.state.changed', agentId: 'unknown-row', data: { runtimeState: 'working' } }, 1);
  assert.equal(h.allowed('unknown-row'), false);
  assert.equal((await adapter.initialSnapshot()).connection.status, 'disconnected');
  h.emit({ type: 'connection.changed', agentId: null, data: { connection: { status: 'connected', lastObservedAt: at, message: null } } });
  assert.equal(h.allowed('unknown-row'), false);
});

test('scope events arriving during initial snapshot are buffered before the reader starts', async () => {
  const h = harness();
  let resolveSnapshot!: (value: typeof h.snapshot) => void;
  const original = structuredClone(h.snapshot);
  const pending = new Promise<typeof h.snapshot>(resolve => { resolveSnapshot = resolve; });
  let first = true;
  const base: OfficeAdapter = { ...h.base, initialSnapshot: () => {
    if (first) { first = false; return pending; }
    return h.base.initialSnapshot();
  } };
  const creating = createAdapter({ createBase: async () => base, createReader: h.createReader, pollMs: 10, now: () => at });
  await until(() => h.subscribers() === 1);
  h.emit({ type: 'agent.upserted', agentId: 'bootstrap-row', data: { agent: agent('bootstrap-row', 'error') } });
  resolveSnapshot(original);
  const adapter = await creating;
  assert.equal(h.allowed('bootstrap-row'), true);
  assert.equal((await adapter.initialSnapshot()).latestTurns?.length, 3);
  await adapter.stop();
});

test('initial snapshot failure closes the base and detaches scope without creating a reader', async () => {
  const h = harness();
  let readerCalled = false;
  await assert.rejects(createAdapter({ createBase: async () => ({ ...h.base,
    initialSnapshot: () => { throw new Error('Synthetic initial failure.'); } }),
    createReader: async options => { readerCalled = true; return h.createReader(options); },
  }), /Synthetic initial failure/);
  assert.equal(readerCalled, false);
  assert.equal(h.stops(), 1);
  assert.equal(h.subscribers(), 0);
});
