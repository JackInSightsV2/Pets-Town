import test from 'node:test';
import assert from 'node:assert/strict';
import { observationSource, createAdapter } from './platform-adapter.js';
import { createUnsupportedAdapter } from '../server/adapter.js';

test('macOS selects the existing daemon; Windows selects existing session logs', () => {
  assert.deepEqual(observationSource('darwin', {}, '/Users/example'), { kind: 'metadata' });
  assert.deepEqual(observationSource('win32', {}, 'C:\\Users\\example'), { kind: 'rollout', defaultRoot: 'C:\\Users\\example\\.codex\\sessions' });
  assert.deepEqual(observationSource('win32', { CODEX_HOME: 'D:\\Codex' }, 'C:\\Users\\example'), { kind: 'rollout', defaultRoot: 'D:\\Codex\\sessions' });
  assert.equal(observationSource('darwin', { PETSTOWN_ROLLOUT_ROOT: '/sessions' }, '/Users/example').kind, 'rollout');
});

test('Windows never attempts the Unix socket and passes its home and environment to the lifecycle reader', async () => {
  const adapter = createUnsupportedAdapter();
  let selectedRoot = '';
  assert.equal(await createAdapter({ platform: 'win32', env: {}, home: 'C:\\Users\\example',
    metadata: async () => { throw new Error('Unix socket must not be used'); },
    rollout: async ({ defaultRoot, env, nameIndex }) => {
      selectedRoot = defaultRoot;
      assert.deepEqual(env, {});
      assert.equal(nameIndex, 'C:\\Users\\example\\.codex\\session_index.jsonl');
      return adapter;
    },
  }), adapter);
  assert.equal(selectedRoot, 'C:\\Users\\example\\.codex\\sessions');
  assert.equal(await createAdapter({ platform: 'darwin', env: {}, home: '/Users/example',
    metadata: async () => adapter, rollout: async () => { throw new Error('Unexpected rollout source'); },
  }), adapter);
});
