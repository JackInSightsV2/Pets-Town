import test from 'node:test';
import assert from 'node:assert/strict';
import { selectObserverNotification } from './observer-notifications.js';

// SYNTHETIC source shapes only; these do not prove passive native delivery.
const interaction = () => ({ method: 'item/completed', params: { threadId: 'synthetic-sender', turnId: 'synthetic-turn',
  item: { type: 'subAgentActivity', id: 'synthetic-item', kind: 'interacted', agentThreadId: 'synthetic-recipient', text: 'SYNTHETIC_PRIVATE_TEXT', agentPath: '/synthetic/private' } } });
test('synthetic: receipt-backed item identity survives and unrelated private fields do not', () => {
  const raw = interaction();
  const selected = selectObserverNotification(raw);
  assert.deepEqual(selected, { method: 'item/completed', params: { threadId: 'synthetic-sender', turnId: 'synthetic-turn',
    item: { type: 'subAgentActivity', id: 'synthetic-item', kind: 'interacted', agentThreadId: 'synthetic-recipient' } } });
  assert.ok(!JSON.stringify(selected).includes('PRIVATE'));
  raw.params.item.id = 'changed';
  assert.ok(JSON.stringify(selected).includes('synthetic-item'));
});
test('synthetic: requests, legacy collaboration, incomplete identities and other notifications are excluded', () => {
  for (const value of [null, {}, { ...interaction(), id: 1 }, { ...interaction(), method: 'item/started' },
    { ...interaction(), params: { ...interaction().params, turnId: '' } },
    { ...interaction(), params: { ...interaction().params, item: { ...interaction().params.item, type: 'collabAgentToolCall' } } },
    { ...interaction(), params: { ...interaction().params, item: { ...interaction().params.item, agentThreadId: 'synthetic-sender' } } },
    { ...interaction(), params: { ...interaction().params, item: { ...interaction().params.item, senderThreadId: 'different' } } },
    { method: 'item/tool/requestUserInput', params: { threadId: 'synthetic-sender', questions: ['private'] } }]) {
    assert.equal(selectObserverNotification(value), null);
  }
});
test('synthetic: status notifications are copied without guessing unknown flags or lifecycle', () => {
  const raw = { method: 'thread/status/changed', params: { threadId: 'synthetic-agent', status: { type: 'active', activeFlags: ['waitingOnApproval'], private: 'SYNTHETIC_PRIVATE' } } };
  const selected = selectObserverNotification(raw);
  assert.deepEqual(selected, { method: 'thread/status/changed', params: { threadId: 'synthetic-agent', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } });
  raw.params.status.activeFlags.push('futureFlag');
  assert.ok(!JSON.stringify(selected).includes('futureFlag'));
  assert.equal(selectObserverNotification(raw), null);
  assert.equal(selectObserverNotification({ ...raw, params: { threadId: 'synthetic-agent', status: { type: 'completed' } } }), null);
});
