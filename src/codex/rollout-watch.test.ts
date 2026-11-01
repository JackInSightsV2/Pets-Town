import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchRollouts } from './rollout-watch.js';

test('native watch wakes on a file change and stop closes the watcher', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'petstown-watch-'));
  const file = join(dir, 'synthetic.jsonl');
  await writeFile(file, 'baseline\n');
  let count = 0;
  const stop = watchRollouts({ files: [file] }, () => count++);
  try {
    await writeFile(file, 'changed\n');
    const deadline = Date.now() + 3000;
    while (!count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(count > 0);
    stop();
    const before = count;
    await writeFile(file, 'after stop\n');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(count, before);
  } finally { stop(); await rm(dir, { recursive: true, force: true }); }
});

test('missing directories and relative paths do not prevent startup', () => {
  const stop = watchRollouts({ root: join(tmpdir(), 'missing-petstown-watch-test'), files: ['relative'] }, () => {});
  stop(); stop();
});
