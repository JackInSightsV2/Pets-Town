import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createMetadataAdapter, type MetadataReader } from './metadata-adapter.js';
import type { OfficeEvent, OfficeSnapshot } from '../shared/contract.js';

// SYNTHETIC runtime responses. Never used as evidence of a real Codex connection.
const row = (id = 'synthetic-a', status = 'active') => ({ id, cwd: '/synthetic/project', projectId: 'synthetic-project', status: { type: status, activeFlags: [] } });
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(5); }
  assert.fail('Timed out waiting for synthetic observer');
}
class Reader implements MetadataReader {
  connected = true;
  rows = [row()];
  fail = false;
  closes = 0;
  calls: string[] = [];
  async call(method: 'thread/loaded/list' | 'thread/read', params: Record<string, unknown>): Promise<unknown> {
    this.calls.push(method);
    if (this.fail) throw new Error('SYNTHETIC_PRIVATE_ERROR');
    if (method === 'thread/loaded/list') return { data: this.rows.map(value => value.id), nextCursor: null };
    assert.equal(params.includeTurns, false);
    return { thread: this.rows.find(value => value.id === params.threadId) };
  }
  close() { this.closes++; this.connected = false; }
}

test('synthetic: metadata polling deduplicates, reconnects, and preserves execution identity', async () => {
  let current = new Reader();
  let connects = 0;
  let tick = 0;
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10,
    now: () => new Date(1793540000000 + tick++).toISOString(), connect: async () => { connects++; return current; } });
  const initial = await adapter.initialSnapshot();
  const events: OfficeEvent[] = [];
  const cursors: Promise<OfficeSnapshot>[] = [];
  adapter.subscribe(event => { events.push(event); cursors.push(Promise.resolve(adapter.initialSnapshot())); });
  try {
    await until(() => events.filter(event => event.type === 'connection.changed').length >= 2);
    assert.equal(events.filter(event => event.type === 'agent.upserted').length, 0);
    current.rows = [row('synthetic-a', 'idle'), row('synthetic-b')];
    await until(() => events.some(event => event.type === 'agent.upserted' && event.agentId === 'synthetic-b'));
    const snapshots = await Promise.all(cursors);
    snapshots.forEach((snapshot, i) => assert.equal(snapshot.lastSeq, events[i].seq));
    const after = await adapter.initialSnapshot();
    assert.equal(after.agents.length, 2);
    assert.equal(after.agents[0].agentId, initial.agents[0].agentId);
    assert.equal(after.agents[0].petAssetId, initial.agents[0].petAssetId);
    current.fail = true;
    await until(() => events.some(event => event.type === 'connection.changed' && event.data.connection.status === 'disconnected'));
    assert.equal((await adapter.initialSnapshot()).agents[0].runtimeState, 'idle');
    assert.ok(!JSON.stringify(events).includes('SYNTHETIC_PRIVATE_ERROR'));
    const beforeReconnect = events.length;
    current = new Reader();
    await until(() => connects >= 2 && events.slice(beforeReconnect).some(event => event.type === 'agent.upserted' && event.agentId === 'synthetic-a' && event.data.agent.runtimeState === 'working'));
    const rejoined = await adapter.initialSnapshot();
    assert.equal(rejoined.agents.filter(agent => agent.agentId === 'synthetic-a').length, 1);
    assert.equal(rejoined.agents.find(agent => agent.agentId === 'synthetic-b')?.runtimeState, 'unknown');
    assert.ok(events.every(event => event.type !== 'agent.closed' && event.type !== 'agent.work.completed'));
    assert.ok(current.calls.every(method => method === 'thread/read' || method === 'thread/loaded/list'));
  } finally { adapter.stop(); }
});

test('synthetic: stop during a pending read prevents publication and rearming', async () => {
  const reader = new Reader();
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10, connect: async () => reader });
  await adapter.initialSnapshot();
  let finish: ((value: unknown) => void) | undefined;
  reader.call = async () => new Promise(resolve => { finish = resolve; });
  const events: OfficeEvent[] = [];
  adapter.subscribe(event => events.push(event));
  await until(() => Boolean(finish));
  adapter.stop();
  finish!({ data: [], nextCursor: null });
  await sleep(40);
  assert.deepEqual(events, []);
  assert.equal(reader.closes, 1);
});

test('synthetic: paginated discovery rejects mismatched read correlation atomically', async () => {
  let malformed = false;
  const calls: string[] = [];
  const reader: MetadataReader = {
    connected: true, close() {},
    async call(method, params) {
      calls.push(method);
      if (method === 'thread/loaded/list') return params.cursor ? { data: ['synthetic-b'], nextCursor: null } : { data: ['synthetic-a'], nextCursor: 'second' };
      return { thread: row(malformed ? 'synthetic-wrong' : params.threadId as string) };
    },
  };
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10, connect: async () => reader });
  try {
    assert.equal((await adapter.initialSnapshot()).agents.length, 2);
    malformed = true;
    let disconnected = false;
    adapter.subscribe(event => { if (event.type === 'connection.changed' && event.data.connection.status === 'disconnected') disconnected = true; });
    await until(() => disconnected);
    const snapshot = await adapter.initialSnapshot();
    assert.equal(snapshot.agents.length, 2);
    assert.ok(snapshot.agents.every(agent => agent.runtimeState === 'working'));
  } finally { adapter.stop(); }
});

test('synthetic: new project is explicitly deferred until Office v1 gains project events', async () => {
  const reader = new Reader();
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10, connect: async () => reader });
  await adapter.initialSnapshot();
  reader.rows = [{ ...row('synthetic-new'), projectId: 'synthetic-new-project' }];
  let deferred = false;
  adapter.subscribe(event => { if (event.type === 'connection.changed' && event.data.connection.message?.includes('new project')) deferred = true; });
  try {
    await until(() => deferred);
    const snapshot = await adapter.initialSnapshot();
    assert.equal(snapshot.agents.some(agent => agent.agentId === 'synthetic-new'), false);
    assert.equal(snapshot.agents[0].runtimeState, 'unknown');
  } finally { adapter.stop(); }
});
