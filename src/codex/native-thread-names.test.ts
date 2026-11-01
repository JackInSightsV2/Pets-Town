import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { MetadataReader } from './metadata-adapter.js';
import { readNativeThreadNames, withNativeThreadNames } from './native-thread-names.js';

// All records and names below are synthetic; no real local metadata is retained in fixtures.
test('native index retains only exact requested IDs and uses timestamps, not file order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'petstown-names-'));
  const path = join(directory, 'session_index.jsonl');
  try {
    await writeFile(path, [
      { id: 'synthetic-a', thread_name: 'Current title', updated_at: '2026-11-01T12:02:00Z' },
      { id: 'synthetic-unscoped', thread_name: 'UNRELATED_PRIVATE_TITLE', updated_at: '2026-11-01T12:03:00Z' },
      { id: 'synthetic-a', thread_name: 'Old title', updated_at: '2026-11-01T12:01:00Z' },
      { id: 'synthetic-b', thread_name: 'Conflicting one', updated_at: '2026-11-01T12:02:00Z' },
      { id: 'synthetic-b', thread_name: 'Conflicting two', updated_at: '2026-11-01T12:02:00Z' },
    ].map(row => JSON.stringify(row) + '\n').join('') + '{"id":"synthetic-a","thread_name":"unfinished');
    const names = await readNativeThreadNames(path, new Set(['synthetic-a', 'synthetic-b']));
    assert.deepEqual([...names], [['synthetic-a', 'Current title']]);
    assert.ok(!JSON.stringify([...names]).includes('UNRELATED_PRIVATE_TITLE'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function sourceWith(thread: Record<string, unknown>): MetadataReader & { closed: boolean } {
  return {
    connected: true, closed: false, healthMessage: 'Synthetic source notice',
    close() { this.closed = true; },
    async call(method) {
      if (method === 'thread/loaded/list') return { data: ['synthetic-a'], nextCursor: null };
      if (method === 'thread/read') return { thread };
      throw new Error('Unsupported synthetic goal read');
    },
  };
}

test('names decorate only matching source identity in an allowed project, without mutating metadata', async () => {
  const thread = { id: 'synthetic-a', cwd: '/synthetic/project', agentNickname: 'Native nickname', status: { type: 'idle' } };
  const source = sourceWith(thread);
  const lookedUp: string[][] = [];
  const reader = withNativeThreadNames(source, { allowedCwds: ['/synthetic/project'], readNames: async ids => {
    lookedUp.push([...ids]);
    return new Map([['synthetic-a', 'Actual title'], ['unrequested-id', 'Never retain']]);
  } });
  const result = await reader.call('thread/read', { threadId: 'synthetic-a', includeTurns: false }) as { thread: typeof thread & { name: string } };
  assert.equal(result.thread.name, 'Actual title');
  assert.equal(result.thread.agentNickname, 'Native nickname');
  assert.deepEqual(result.thread.status, { type: 'idle' });
  assert.equal('name' in thread, false);
  assert.deepEqual(lookedUp, [['synthetic-a']]);
  assert.equal(reader.connected, true);
  assert.equal(reader.healthMessage, 'Synthetic source notice');
  reader.close();
  assert.equal(source.closed, true);
});

test('names never read for mismatched identities or out-of-scope source metadata', async () => {
  for (const thread of [
    { id: 'synthetic-impostor', cwd: '/synthetic/project' },
    { id: 'synthetic-a', cwd: '/synthetic/another-project' },
  ]) {
    let calls = 0;
    const reader = withNativeThreadNames(sourceWith(thread), { allowedCwds: ['/synthetic/project'], readNames: async () => { calls++; return new Map(); } });
    assert.deepEqual(await reader.call('thread/read', { threadId: 'synthetic-a', includeTurns: false }), { thread });
    assert.equal(calls, 0);
  }
});

test('native renames refresh with polling; an optional index failure preserves source metadata', async () => {
  const source = sourceWith({ id: 'synthetic-a', cwd: '/synthetic/project', agentNickname: 'Native nickname' });
  let title = 'Original title';
  let fail = false;
  const reader = withNativeThreadNames(source, { allowedCwds: ['/synthetic/project'], readNames: async () => {
    if (fail) throw new Error('Synthetic unreadable index');
    return new Map([['synthetic-a', title]]);
  } });
  const read = async () => await reader.call('thread/read', { threadId: 'synthetic-a', includeTurns: false }) as { thread: { name?: string; agentNickname: string } };
  assert.equal((await read()).thread.name, 'Original title');
  title = 'Renamed native title';
  await reader.call('thread/loaded/list', {});
  assert.equal((await read()).thread.name, title);
  fail = true;
  await reader.call('thread/loaded/list', {});
  assert.equal((await read()).thread.name, undefined);
  assert.equal((await read()).thread.agentNickname, 'Native nickname');
  assert.equal(reader.connected, true);
});
