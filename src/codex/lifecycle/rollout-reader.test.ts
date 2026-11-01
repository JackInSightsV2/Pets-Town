import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RolloutLifecycleReader } from './rollout-reader.js';

const VERSION = '0.166.0-alpha.5.1';
const line = (value: unknown) => JSON.stringify(value) + '\n';
const meta = (cwd: string, id = 'synthetic-agent', extras: Record<string, unknown> = {}, ordinal = 0) => line({ type: 'session_meta', ordinal,
  timestamp: '2026-01-01T00:00:00.000Z', payload: { id, cwd, cli_version: VERSION, source: 'vscode', ...extras } });
const event = (type: string, turnId = 'synthetic-turn', ordinal = 1, extras: Record<string, unknown> = {}) => line({
  type: 'event_msg', ordinal, timestamp: '2026-01-01T00:00:10.000Z', payload: { type, turn_id: turnId, started_at: 1767225605, ...extras },
});
async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-reader-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, 'synthetic.jsonl') };
}
const options = (path: string, cwd: string) => ({ paths: [path], allowedCwds: [cwd], sourceNamespace: 'synthetic-runtime', now: () => '2026-01-01T00:00:01.000Z' });

test('historical explicit success, failure and interruption establish silent latest baseline', async t => {
  const { dir, path } = await fixture(t);
  for (const terminal of ['success', 'failure', 'interruption']) {
    const records = meta(dir) + event('task_started')
      + (terminal === 'failure' ? event('error', 'synthetic-turn', 2, { message: 'PRIVATE', codex_error_info: 'other' }) : '')
      + (terminal === 'interruption' ? event('turn_aborted', 'synthetic-turn', 3, { reason: 'interrupted' }) : event('task_complete', 'synthetic-turn', 3));
    await writeFile(path, records);
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.deepEqual(result.observations, []); assert.equal(result.quarantined, 0);
    assert.equal(result.latestTurns[0].status, terminal === 'success' ? 'succeeded' : terminal === 'failure' ? 'failed' : 'interrupted');
    assert.equal(result.latestTurns[0].delivery, 'history');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('historical unfinished start stays unknown but appended starts and terminals emit once', async t => {
  const { dir, path } = await fixture(t);
  await writeFile(path, meta(dir) + event('task_started', 'old-turn'));
  const reader = new RolloutLifecycleReader(options(path, dir)); t.after(() => reader.close());
  assert.deepEqual((await reader.scan()).latestTurns, []);
  await appendFile(path, event('task_started', 'new-turn', 2) + event('task_complete', 'new-turn', 3));
  const result = await reader.scan();
  assert.deepEqual(result.observations.map(row => [row.status, row.delivery]), [['started', 'live'], ['succeeded', 'live']]);
  assert.equal(result.latestTurns[0].status, 'succeeded');
  assert.deepEqual((await reader.scan()).observations, []);
});

test('initial partial lifecycle line stays historical when completed later', async t => {
  const { dir, path } = await fixture(t);
  const completion = event('task_complete', 'synthetic-turn', 2), split = Math.floor(completion.length / 2);
  await writeFile(path, meta(dir) + event('task_started') + completion.slice(0, split));
  const reader = new RolloutLifecycleReader(options(path, dir)); t.after(() => reader.close());
  assert.deepEqual((await reader.scan()).latestTurns, []);
  await appendFile(path, completion.slice(split));
  assert.deepEqual((await reader.scan()).observations.map(row => [row.status, row.delivery]), [['succeeded', 'history']]);
});

test('a newly discovered fresh owned ongoing start enters, but old and already-ended work does not replay', async t => {
  const { dir } = await fixture(t);
  let discovered: string[] = [], now = '2026-01-01T00:00:01.000Z';
  const reader = new RolloutLifecycleReader({ paths: [], discover: async () => discovered, allowedCwds: [dir], sourceNamespace: 'synthetic', now: () => now });
  t.after(() => reader.close()); await reader.scan(); now = '2026-01-01T00:00:10.000Z';
  const fresh = join(dir, 'fresh.jsonl'), old = join(dir, 'old.jsonl'), done = join(dir, 'done.jsonl');
  await writeFile(fresh, meta(dir, 'fresh') + event('task_started', 'fresh-turn', 1));
  await writeFile(old, meta(dir, 'old') + event('task_started', 'old-turn', 1, { started_at: 1767225500 }));
  await writeFile(done, meta(dir, 'done') + event('task_started', 'done-turn', 1) + event('task_complete', 'done-turn', 2));
  discovered = [fresh, old, done];
  const result = await reader.scan();
  assert.deepEqual(result.observations.map(row => [row.agentId, row.status, row.delivery]), [['fresh', 'started', 'live'], ['done', 'succeeded', 'history']]);
  assert.equal(result.latestTurns.length, 2);
});

test('child ownership boundary ignores copied parent metadata and lifecycle before the boundary', async t => {
  const { dir, path } = await fixture(t);
  const child = { parent_thread_id: 'parent', forked_from_id: 'parent', subagent_history_start_ordinal: 10,
    source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } };
  await writeFile(path, meta(dir, 'child', child) + meta('/different-parent-project', 'parent', {}, 1)
    + event('task_started', 'parent-turn', 2) + event('task_complete', 'parent-turn', 3)
    + event('task_started', 'child-turn', 11) + event('turn_aborted', 'child-turn', 12, { reason: 'interrupted' }));
  const reader = new RolloutLifecycleReader(options(path, dir)); t.after(() => reader.close());
  const result = await reader.scan(); assert.equal(result.quarantined, 0);
  assert.deepEqual(result.latestTurns.map(row => [row.agentId, row.status]), [['child', 'interrupted']]);
});

test('ambiguous inherited ownership and unknown source versions never establish presence', async t => {
  const { dir, path } = await fixture(t);
  for (const extra of [{ parent_thread_id: 'parent', source: { subagent: { other: {} } } }, { forked_from_id: 'parent' }, { cli_version: 'unverified-version' }]) {
    await writeFile(path, meta(dir, 'child', extra) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.deepEqual(result.latestTurns, []); assert.deepEqual(result.observations, []);
  }
});

test('scope, duplicate identity and a later invalid record block staged lifecycle output', async t => {
  const { dir, path } = await fixture(t);
  await writeFile(path, meta(dir));
  const reader = new RolloutLifecycleReader(options(path, dir)); t.after(() => reader.close()); await reader.scan();
  await appendFile(path, event('task_started') + event('task_complete', 'synthetic-turn', 2) + '{invalid}\n');
  const invalid = await reader.scan(); assert.equal(invalid.quarantined, 1); assert.deepEqual(invalid.observations, []); assert.deepEqual(invalid.latestTurns, []);
  const outside = join(dir, 'outside.jsonl');
  await writeFile(outside, meta(join(dir, 'other')) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
  const scoped = new RolloutLifecycleReader(options(outside, dir)); assert.deepEqual((await scoped.scan()).latestTurns, []); scoped.close();
  const duplicate = join(dir, 'duplicate.jsonl');
  await writeFile(path, meta(dir) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
  await writeFile(duplicate, meta(dir) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
  const doubled = new RolloutLifecycleReader({ ...options(path, dir), paths: [path, duplicate] });
  const result = await doubled.scan(); doubled.close(); assert.equal(result.quarantined, 2); assert.deepEqual(result.latestTurns, []);
});

test('changed own identity and missing owned ordinals quarantine boundary-backed files', async t => {
  const { dir, path } = await fixture(t);
  await writeFile(path, meta(dir, 'child', { parent_thread_id: 'parent', subagent_history_start_ordinal: 10 })
    + meta(dir, 'different', {}, 11));
  const reader = new RolloutLifecycleReader(options(path, dir));
  assert.equal((await reader.scan()).quarantined, 1); reader.close();
  await writeFile(path, meta(dir, 'child', { parent_thread_id: 'parent', subagent_history_start_ordinal: 10 })
    + line({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'child-turn' } }));
  const missing = new RolloutLifecycleReader(options(path, dir));
  assert.equal((await missing.scan()).quarantined, 1); missing.close();
});

test('fresh child with boundary enters but copied fresh-looking parent start cannot', async t => {
  const { dir } = await fixture(t);
  let paths: string[] = [], now = '2026-01-01T00:00:01.000Z';
  const reader = new RolloutLifecycleReader({ paths, discover: async () => paths, allowedCwds: [dir], sourceNamespace: 'synthetic', now: () => now });
  t.after(() => reader.close()); await reader.scan(); now = '2026-01-01T00:00:10.000Z';
  const fresh = join(dir, 'child.jsonl'), copied = join(dir, 'copied.jsonl');
  await writeFile(fresh, meta(dir, 'child', { parent_thread_id: 'parent', forked_from_id: 'parent', subagent_history_start_ordinal: 10 })
    + event('task_started', 'parent-turn', 1) + event('task_started', 'child-turn', 11));
  await writeFile(copied, meta(dir, 'copied', { parent_thread_id: 'parent', forked_from_id: 'parent', subagent_history_start_ordinal: 10 })
    + event('task_started', 'parent-turn', 1));
  paths = [fresh, copied];
  assert.deepEqual((await reader.scan()).observations.map(row => [row.agentId, row.status]), [['child', 'started']]);
});

test('close produces no output and invalid selection is rejected without opening files', async () => {
  assert.throws(() => new RolloutLifecycleReader({ paths: ['relative'], allowedCwds: ['/project'], sourceNamespace: 'synthetic' }));
  const reader = new RolloutLifecycleReader({ paths: [], discover: async () => [], allowedCwds: ['/project'], sourceNamespace: 'synthetic' });
  reader.close(); assert.deepEqual(await reader.scan(), { observations: [], latestTurns: [], quarantined: 0 });
});

test('a duplicate claimant cannot leak a valid peer even when its own later record is corrupt', async t => {
  const { dir, path } = await fixture(t);
  const other = join(dir, 'corrupt-duplicate.jsonl');
  await writeFile(path, meta(dir) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
  await writeFile(other, meta(dir) + '{invalid}\n');
  const reader = new RolloutLifecycleReader({ ...options(path, dir), paths: [path, other] });
  const result = await reader.scan(); reader.close();
  assert.equal(result.quarantined, 2); assert.deepEqual(result.latestTurns, []); assert.deepEqual(result.observations, []);
});

test('exact paginated child discriminator proves local history without a copied-prefix boundary', async t => {
  const { dir, path } = await fixture(t);
  for (const thread_source of ['subagent', 'guardian_review']) {
    await writeFile(path, meta(dir, 'child', { parent_thread_id: 'parent', history_mode: 'paginated', thread_source,
      source: { subagent: { other: {} } } }) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.deepEqual(result.latestTurns.map(row => [row.agentId, row.status]), [['child', 'succeeded']]);
    assert.deepEqual(result.observations, []);
  }
});

test('new own paginated child already started at first discovery enters exactly once', async t => {
  const { dir, path } = await fixture(t);
  let paths: string[] = [], now = '2026-01-01T00:00:01.000Z';
  const reader = new RolloutLifecycleReader({ paths: [], discover: async () => paths, allowedCwds: [dir], sourceNamespace: 'synthetic', now: () => now });
  t.after(() => reader.close()); await reader.scan(); now = '2026-01-01T00:00:10.000Z';
  await writeFile(path, meta(dir, 'new-child', { parent_thread_id: 'parent', history_mode: 'paginated', thread_source: 'subagent',
    source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }) + event('task_started'));
  paths = [path];
  assert.deepEqual((await reader.scan()).observations.map(row => [row.agentId, row.status, row.delivery]), [['new-child', 'started', 'live']]);
  assert.deepEqual((await reader.scan()).observations, []);
});

test('no-marker child proof rejects inherited markers and every unsupported mode or source discriminator', async t => {
  const { dir, path } = await fixture(t);
  const own = { parent_thread_id: 'parent', history_mode: 'paginated', thread_source: 'subagent', source: { subagent: { other: {} } } };
  for (const overrides of [{ history_mode: 'legacy' }, { history_mode: undefined }, { thread_source: 'user' }, { thread_source: undefined },
    { forked_from_id: 'parent' }, { attached_thread: 'parent' }, { forked_from_ordinal_exclusive: 7 }, { history_base: { thread_id: 'parent' } }]) {
    await writeFile(path, meta(dir, 'child', { ...own, ...overrides }) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.deepEqual(result.latestTurns, []); assert.deepEqual(result.observations, []);
  }
});

test('native attached_thread false means unattached but true blocks no-marker ownership', async t => {
  const { dir, path } = await fixture(t);
  for (const attached_thread of [undefined, false, true]) {
    await writeFile(path, meta(dir, 'child', { parent_thread_id: 'parent', history_mode: 'paginated', thread_source: 'subagent', attached_thread,
      source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.equal(result.latestTurns.length, attached_thread === true ? 0 : 1); assert.equal(result.quarantined, 0);
  }
});

test('invalid attachment marker fails closed instead of granting local ownership', async t => {
  const { dir, path } = await fixture(t);
  for (const attached_thread of [null, 'false', 0, {}]) {
    await writeFile(path, meta(dir, 'child', { parent_thread_id: 'parent', history_mode: 'paginated', thread_source: 'subagent', attached_thread })
      + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.equal(result.quarantined, 1); assert.deepEqual(result.latestTurns, []);
  }
});

test('known native vscode roots are supported but unverified CLI and internal source paths are not', async t => {
  const { dir, path } = await fixture(t);
  for (const source of ['vscode', 'cli', 'exec', 'internal', 'unknown']) {
    await writeFile(path, meta(dir, 'root', { source }) + event('task_started') + event('task_complete', 'synthetic-turn', 2));
    const reader = new RolloutLifecycleReader(options(path, dir));
    const result = await reader.scan(); reader.close();
    assert.equal(result.latestTurns.length, source === 'vscode' ? 1 : 0);
  }
});
