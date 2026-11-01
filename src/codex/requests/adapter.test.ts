import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createUnsupportedReplyAdapter } from './adapter.js';

test('unverified response capability always fails closed', async () => {
  const result = await createUnsupportedReplyAdapter().respond({
    identity: { daemonId: 'daemon', connectionId: 'connection', agentId: 'agent', sourceRequestId: 1 },
    expectedRevision: 1, kind: 'user-input', idempotencyKey: 'key', response: { answer: 'fixture' },
  });
  assert.equal(result.status, 'unsupported');
});
