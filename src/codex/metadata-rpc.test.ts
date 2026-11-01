import assert from 'node:assert/strict';
import test from 'node:test';
import { statusNotificationThreadId } from './metadata-rpc.js';

test('only valid status notifications provide a wake-up identity', () => {
  assert.equal(statusNotificationThreadId({ method: 'thread/status/changed', params: { threadId: 'synthetic', status: { type: 'idle' } } }), 'synthetic');
  for (const message of [null, {}, { id: 1, method: 'thread/status/changed', params: { threadId: 'a', status: {} } },
    { method: 'item/completed', params: { threadId: 'a', status: {} } },
    { method: 'thread/status/changed', params: { threadId: '', status: {} } },
    { method: 'thread/status/changed', params: { threadId: 'a' } }]) {
    assert.equal(statusNotificationThreadId(message), null);
  }
});
