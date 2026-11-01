import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, appendFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMetadataAdapter } from './metadata-adapter.js';
import { RolloutReader } from './rollout-reader.js';

const line = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n';
const meta = line('session_meta', { id: 'synthetic-id', cwd: '/synthetic/project', parent_thread_id: 'synthetic-parent' });
const event = (type: string, turn_id = 'synthetic-turn', extra = {}) => line('event_msg', { type, turn_id, ...extra });
async function fixture(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'rollout-reader-'));
  try { await run(join(dir, 'rollout.jsonl')); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function status(reader: RolloutReader) {
  await reader.call('thread/loaded/list', {});
  const result = await reader.call('thread/read', { threadId: 'synthetic-id', includeTurns: false }) as { thread: { status: { type: string } } };
  return result.thread.status.type;
}

test('historical start is unknown; appended lifecycle is observed without transcript', async () => fixture(async path => {
  await writeFile(path, meta + event('task_started') + line('response_item', { text: 'private synthetic text' }));
  const reader = new RolloutReader([path]);
  assert.equal(await status(reader), 'unknown');
  const result = await reader.call('thread/read', { threadId: 'synthetic-id', includeTurns: false });
  assert.equal(JSON.stringify(result).includes('private synthetic text'), false);
  assert.equal((result as {thread: {parentThreadId:string}}).thread.parentThreadId, 'synthetic-parent');
  await appendFile(path, event('task_complete'));
  assert.equal(await status(reader), 'idle');
  await appendFile(path, event('turn_started'));
  assert.equal(await status(reader), 'active');
  await appendFile(path, event('turn_complete', 'synthetic-turn', { error: { message: 'private error' } }));
  assert.equal(await status(reader), 'systemError');
  await appendFile(path, event('turn_started') + event('turn_aborted'));
  assert.equal(await status(reader), 'unknown');
  reader.close();
  await assert.rejects(reader.call('thread/loaded/list', {}));
}));

test('partial historical line remains historical and fresh lines require a newline', async () => fixture(async path => {
  const start = event('task_started');
  await writeFile(path, meta + start.slice(0, -2));
  const reader = new RolloutReader([path]);
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, start.slice(-2));
  assert.equal(await status(reader), 'unknown');
  const fresh = event('task_started', 'second');
  await appendFile(path, fresh.slice(0, -1));
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, '\n');
  assert.equal(await status(reader), 'active');
}));

test('truncation and replacement fail closed', async () => fixture(async path => {
  await writeFile(path, meta + event('task_started'));
  const reader = new RolloutReader([path]);
  await status(reader);
  await writeFile(path, meta);
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  assert.equal(reader.connected, true);
  assert.match(reader.healthMessage!, /quarantined/);
}));

test('oversized or malformed lines fail closed and read requests cannot include turns', async () => fixture(async path => {
  await writeFile(path, meta);
  const reader = new RolloutReader([path]);
  await status(reader);
  await assert.rejects(reader.call('thread/read', { threadId: 'synthetic-id', includeTurns: true }));
  await appendFile(path, 'x'.repeat(16 * 1024 * 1024 + 1));
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  assert.match(reader.healthMessage!, /quarantined/);
}));

test('replacement at the same path fails closed', async () => fixture(async path => {
  await writeFile(path, meta);
  const reader = new RolloutReader([path]);
  await status(reader);
  await rename(path, path + '.old');
  await writeFile(path, meta + event('task_started'));
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  assert.match(reader.healthMessage!, /quarantined/);
}));

test('synthetic: a historical partial line stays historical across several polls', async () => fixture(async path => {
  const started = event('task_started');
  await writeFile(path, meta + started.slice(0, 15));
  const reader = new RolloutReader([path]);
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, started.slice(15, 25));
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, started.slice(25));
  assert.equal(await status(reader), 'unknown');
}));

test('synthetic: missing turn correlation cannot claim working or idle', async () => fixture(async path => {
  await writeFile(path, meta);
  const reader = new RolloutReader([path]);
  await status(reader);
  await appendFile(path, line('event_msg', { type: 'task_started' }));
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, line('event_msg', { type: 'task_complete' }));
  assert.equal(await status(reader), 'unknown');
}));

test('large historical transcripts and large records use bounded reads and retain lifecycle semantics', async () => fixture(async path => {
  const largeRecord = line('response_item', { text: 'x'.repeat(9 * 1024 * 1024) });
  await writeFile(path, meta + largeRecord + event('task_started', 'old'));
  const reader = new RolloutReader([path]);
  assert.equal(await status(reader), 'unknown');
  await appendFile(path, event('task_complete', 'old') + event('task_started', 'new'));
  assert.equal(await status(reader), 'active');
  await appendFile(path, event('task_complete', 'new'));
  assert.equal(await status(reader), 'idle');
}));

test('synthetic: metadata adapter connects to rollout reader when goals are unsupported', async () => fixture(async path => {
  const cwd = resolve('synthetic-project');
  await writeFile(path, line('session_meta', { id: 'synthetic-id', cwd }));
  const adapter = await createMetadataAdapter({ allowedCwds: [cwd], connect: async () => new RolloutReader([path]) });
  try {
    const snapshot = await adapter.initialSnapshot();
    assert.equal(snapshot.connection.status, 'connected');
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].agentId, 'synthetic-id');
  } finally { adapter.stop(); }
}));

test('one bad file and duplicate identities are isolated from healthy sessions', async () => fixture(async path => {
  const good = path + '.good', bad = path + '.bad', duplicate = path + '.duplicate';
  await writeFile(good, line('session_meta', { id: 'good', cwd: '/synthetic/project' }));
  await writeFile(path, meta); await writeFile(duplicate, meta); await writeFile(bad, '{broken}\n');
  const reader = new RolloutReader([good, path, duplicate, bad]);
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, ['good']);
  assert.match(reader.healthMessage!, /3 rollout file/);
  assert.equal(reader.connected, true);
}));

test('historical completion does not claim current idle', async () => fixture(async path => {
  await writeFile(path, meta + event('task_started') + event('task_complete'));
  assert.equal(await status(new RolloutReader([path])), 'unknown');
}));

test('discovers new files after an initially empty source', async () => fixture(async path => {
  let paths: string[] = [];
  const reader = new RolloutReader([], async () => paths);
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  await writeFile(path, meta); paths = [path];
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, ['synthetic-id']);
}));

test('passes through a native agent nickname without reading transcript text', async () => fixture(async path => {
  await writeFile(path, line('session_meta', { id: 'synthetic-id', cwd: '/synthetic/project', agent_nickname: 'Scout' }));
  const reader = new RolloutReader([path]); await reader.call('thread/loaded/list', {});
  const result = await reader.call('thread/read', { threadId: 'synthetic-id', includeTurns: false }) as {thread: {agentNickname:string}};
  assert.equal(result.thread.agentNickname, 'Scout');
}));

test('a late third file cannot revive a quarantined duplicate identity', async () => fixture(async path => {
  const second = path + '.second', third = path + '.third';
  await writeFile(path, meta); await writeFile(second, meta); await writeFile(third, meta);
  let paths = [path, second];
  const reader = new RolloutReader([], async () => paths);
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  paths = [third];
  assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
  assert.match(reader.healthMessage!, /3 rollout file/);
}));

test('discovery churn is bounded across polls', async () => fixture(async path => {
  let paths = Array.from({length: 1000}, (_, i) => `${path}-${i}`);
  const reader = new RolloutReader([], async () => paths);
  await reader.call('thread/loaded/list', {});
  paths = [path + '-new'];
  await assert.rejects(reader.call('thread/loaded/list', {}), /Cumulative rollout discovery limit/);
}));

test('changed cwd or parent for the same identity quarantines the file', async () => fixture(async path => {
  for (const changed of [
    {id: 'synthetic-id', cwd: '/synthetic/other', parent_thread_id: 'synthetic-parent'},
    {id: 'synthetic-id', cwd: '/synthetic/project', parent_thread_id: 'other-parent'},
  ]) {
    await writeFile(path, meta + line('session_meta', changed));
    const reader = new RolloutReader([path]);
    assert.deepEqual((await reader.call('thread/loaded/list', {}) as {data:string[]}).data, []);
    assert.match(reader.healthMessage!, /quarantined/);
  }
}));
