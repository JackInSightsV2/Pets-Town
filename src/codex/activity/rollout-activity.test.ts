import test from 'node:test';
import assert from 'node:assert/strict';
import { RolloutActivityBatch, RolloutActivityNormalizer } from './rollout-activity.js';

const event = (itemId: string, threadId = 'thread') => ({ type:'event_msg', payload:{ type:'item_completed', thread_id:threadId, turn_id:'turn',
  item:{type:'CommandExecution', id:itemId, status:'completed', command:'PRIVATE', output:'PRIVATE'} } });
test('stages fixed fields, seeds history and deduplicates subsequent replay', () => {
  const normalizer = new RolloutActivityNormalizer('runtime', () => '2026-11-01T12:00:00Z');
  const initial = new RolloutActivityBatch(); initial.add('thread', 'turn', event('old'), true);
  assert.deepEqual(normalizer.commit(initial, 'thread', 'agent'), []);
  const live = new RolloutActivityBatch(); live.add('thread', 'turn', event('old'), false); live.add('thread', 'turn', event('new'), false);
  const output = normalizer.commit(live, 'thread', 'agent');
  assert.equal(output.length, 1); assert.equal(output[0].summary, 'Ran a command.');
  assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(output).includes('new'), false);
});
test('mismatched records are ignored and overflow fails closed', () => {
  const normalizer = new RolloutActivityNormalizer('runtime', () => '2026-11-01T12:00:00Z');
  const mismatch = new RolloutActivityBatch(); mismatch.add('thread', 'turn', event('bad', 'other'), false);
  assert.deepEqual(normalizer.commit(mismatch, 'thread', 'agent'), []);
  const full = new RolloutActivityBatch(1); full.add('thread', 'turn', event('one'), false); full.add('thread', 'turn', event('two'), false);
  assert.throws(() => normalizer.commit(full, 'thread', 'agent'));
  assert.throws(() => normalizer.commit(new RolloutActivityBatch(), 'thread', 'agent'));
});

test('rejects missing or mismatched independently observed turn identity', () => {
  const batch = new RolloutActivityBatch();
  batch.add('thread', 'other-turn', event('wrong-turn'), false);
  batch.add('thread', undefined, event('unknown-turn'), false);
  assert.deepEqual(new RolloutActivityNormalizer('runtime').commit(batch, 'thread', 'agent'), []);
});
