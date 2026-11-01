import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createMetadataAdapter, type MetadataReader } from './metadata-adapter.js';
import { MetadataRpcError } from './metadata-rpc.js';
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
  async call(method: 'thread/loaded/list' | 'thread/read' | 'thread/goal/get', params: Record<string, unknown>): Promise<unknown> {
    this.calls.push(method);
    if (this.fail) throw new Error('SYNTHETIC_PRIVATE_ERROR');
    if (method === 'thread/loaded/list') return { data: this.rows.map(value => value.id), nextCursor: null };
    if (method === 'thread/goal/get') return { goal: null };
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
    assert.ok(current.calls.every(method => method === 'thread/read' || method === 'thread/loaded/list' || method === 'thread/goal/get'));
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

test('synthetic: empty startup discovers projects before agents and streams later project changes with matching cursors', async () => {
  const reader = new Reader();
  reader.rows = [];
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project', '/synthetic/second'], pollMs: 10, connect: async () => reader });
  assert.deepEqual((await adapter.initialSnapshot()).projects, []);
  const events: OfficeEvent[] = [];
  const snapshots: Promise<OfficeSnapshot>[] = [];
  adapter.subscribe(event => { events.push(event); snapshots.push(Promise.resolve(adapter.initialSnapshot())); });
  try {
    reader.rows = [row()];
    await until(() => events.some(event => event.type === 'agent.upserted'));
    assert.ok(events.findIndex(event => event.type === 'project.upserted')
      < events.findIndex(event => event.type === 'agent.upserted'));
    reader.rows = [{ ...row(), cwd: '/synthetic/second' }];
    await until(() => events.some(event => event.type === 'project.upserted' && event.data.project.cwd === '/synthetic/second'));
    reader.rows.push({ ...row('synthetic-new'), projectId: 'synthetic-new-project' });
    await until(() => events.some(event => event.type === 'agent.upserted' && event.agentId === 'synthetic-new'));
    assert.ok(events.findIndex(event => event.type === 'project.upserted' && event.data.project.projectId === 'synthetic-new-project')
      < events.findIndex(event => event.type === 'agent.upserted' && event.agentId === 'synthetic-new'));
    (await Promise.all(snapshots)).forEach((snapshot, index) => {
      const event = events[index];
      assert.equal(snapshot.lastSeq, event.seq);
      if (event.type === 'agent.upserted') assert.ok(snapshot.projects.some(project => project.projectId === event.data.agent.projectId));
      if (event.type === 'project.upserted') assert.deepEqual(snapshot.projects.find(project => project.projectId === event.data.project.projectId), event.data.project);
    });
    assert.equal((await adapter.initialSnapshot()).agents.length, 2);
  } finally { adapter.stop(); }
});

test('synthetic: scoped active goals update tasks; unsupported goals stay unknown and transport loss remains visible', async () => {
  let goalStatus = 'active';
  let failure: Error | null = null;
  const goalIds: string[] = [];
  const reader: MetadataReader = {
    connected: true, close() {},
    async call(method, params) {
      if (method === 'thread/loaded/list') return { data: ['synthetic-a', 'outside'], nextCursor: null };
      if (method === 'thread/read') return { thread: { ...row(params.threadId as string),
        cwd: params.threadId === 'outside' ? '/private/unrelated' : '/synthetic/project' } };
      goalIds.push(params.threadId as string);
      if (failure) throw failure;
      return { goal: { threadId: params.threadId, status: goalStatus, objective: 'Synthetic explicit goal' } };
    },
  };
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10, connect: async () => reader });
  let latest = await adapter.initialSnapshot();
  adapter.subscribe(event => {
    if (event.type === 'agent.upserted') latest.agents = [event.data.agent];
    if (event.type === 'connection.changed') latest.connection = event.data.connection;
  });
  try {
    assert.equal(latest.agents[0].task, 'Goal: Synthetic explicit goal');
    goalStatus = 'complete';
    await until(() => latest.agents[0].task === null);
    assert.ok(goalIds.every(id => id === 'synthetic-a'));
    failure = new Error('Synthetic socket loss');
    await until(() => latest.connection.status === 'disconnected');
    failure = new MetadataRpcError(-32601);
    await until(() => latest.connection.status === 'connected');
    const unsupportedCalls = goalIds.length;
    await sleep(35);
    assert.equal(goalIds.length, unsupportedCalls);
    assert.equal(latest.agents[0].task, null);
  } finally { adapter.stop(); }
});


test('synthetic: scoped status wake reconciles metadata without replay or parallel polls', async () => {
  const reader = new Reader();
  let listener: ((id: string) => void) | undefined;
  let unsubscribed = 0;
  const withStatus: MetadataReader = {
    get connected() { return reader.connected; },
    call: reader.call.bind(reader), close: reader.close.bind(reader),
    subscribeStatus(callback) { listener = callback; return () => { listener = undefined; unsubscribed++; }; },
  };
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10000, connect: async () => withStatus });
  const events: OfficeEvent[] = [];
  adapter.subscribe(event => events.push(event));
  try {
    const baselineCalls = reader.calls.length;
    listener!('other-thread');
    await sleep(90);
    assert.equal(reader.calls.length, baselineCalls);
    reader.rows = [row('synthetic-a', 'idle')];
    for (let i = 0; i < 30; i++) listener!('synthetic-a');
    await until(() => events.some(event => event.type === 'agent.upserted' && event.data.agent.runtimeState === 'idle'));
    assert.equal(reader.calls.length - baselineCalls, 3);
    assert.ok(events.every(event => event.type !== 'agent.work.completed'));
    assert.equal((await adapter.initialSnapshot()).lastSeq, events.at(-1)?.seq);
  } finally { adapter.stop(); }
  assert.equal(unsubscribed, 1);
  assert.equal(listener, undefined);
});


test('synthetic: filesystem wake discovers new scoped rows and closes its subscription', async () => {
  const reader = new Reader(); let wake: (() => void) | undefined; let closed = 0;
  const adapter = await createMetadataAdapter({ allowedCwds: ['/synthetic/project'], pollMs: 10000, connect: async () => reader,
    subscribeWake(callback) { wake = callback; return () => { wake = undefined; closed++; }; } });
  const events: OfficeEvent[] = []; adapter.subscribe(event => events.push(event));
  try {
    reader.rows.push(row('synthetic-b'));
    for (let i = 0; i < 20; i++) wake!();
    await until(() => events.some(event => event.type === 'agent.upserted' && event.agentId === 'synthetic-b'));
    assert.equal(reader.calls.filter(method => method === 'thread/loaded/list').length, 2);
  } finally { adapter.stop(); }
  assert.equal(closed, 1); assert.equal(wake, undefined);
});
