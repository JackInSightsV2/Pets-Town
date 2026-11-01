import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRollouts } from './rollout-discovery.js';

test('discovers new rollout files beneath the root in stable order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rollout-discovery-'));
  try {
    const nested = join(root, '2026', '11', '01');
    await mkdir(nested, { recursive: true });
    const first = join(nested, 'rollout-a.jsonl');
    await writeFile(first, '');
    await writeFile(join(nested, 'notes.jsonl'), '');
    assert.deepEqual(await discoverRollouts(root), [first]);
    const second = join(root, 'rollout-b.jsonl');
    await writeFile(second, '');
    assert.deepEqual(await discoverRollouts(root), [first, second].sort());
    await rm(first);
    assert.deepEqual(await discoverRollouts(root), [second]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects relative roots and treats a missing root as empty', async () => {
  await assert.rejects(discoverRollouts('relative'));
  const root = await mkdtemp(join(tmpdir(), 'rollout-discovery-'));
  try { assert.deepEqual(await discoverRollouts(join(root, 'missing')), []); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('does not traverse directory symlinks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rollout-discovery-'));
  const outside = await mkdtemp(join(tmpdir(), 'rollout-outside-'));
  try {
    await writeFile(join(outside, 'rollout-secret.jsonl'), '');
    try { await symlink(outside, join(root, 'link'), 'junction'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Symlink creation unavailable'); return; } throw error; }
    assert.deepEqual(await discoverRollouts(root), []);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('rejects an excessive number of files rather than returning a partial roster', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rollout-discovery-'));
  try {
    await Promise.all(Array.from({ length: 1001 }, (_, i) => writeFile(join(root, `rollout-${i}.jsonl`), '')));
    await assert.rejects(discoverRollouts(root), /file limit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
