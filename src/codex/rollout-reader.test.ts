import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, appendFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  await assert.rejects(reader.call('thread/loaded/list', {}));
  assert.equal(reader.connected, false);
}));

test('oversized or malformed lines fail closed and read requests cannot include turns', async () => fixture(async path => {
  await writeFile(path, meta);
  const reader = new RolloutReader([path]);
  await status(reader);
  await assert.rejects(reader.call('thread/read', { threadId: 'synthetic-id', includeTurns: true }));
  await appendFile(path, 'x'.repeat(256 * 1024 + 1));
  await assert.rejects(reader.call('thread/loaded/list', {}));
}));

test('replacement at the same path fails closed', async () => fixture(async path => {
  await writeFile(path, meta);
  const reader = new RolloutReader([path]);
  await status(reader);
  await rename(path, path + '.old');
  await writeFile(path, meta + event('task_started'));
  await assert.rejects(reader.call('thread/loaded/list', {}));
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
