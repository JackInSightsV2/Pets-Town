import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleWaiting } from './waiting-sampler.js';

test('deadline closes an outstanding read and ends sampling without emitting late data', async () => {
  let rejectRead: (error: Error) => void = () => {};
  let closed = false;
  const lines: string[] = [];
  const rpc = {
    call: () => new Promise<unknown>((_, reject) => { rejectRead = reject; }),
    close: () => { closed = true; rejectRead(new Error('closed')); },
  };
  await sampleWaiting(rpc, 'thread', line => lines.push(line), 20, 2);
  assert.equal(closed, true);
  assert.deepEqual(lines, []);
});

test('deadline interrupts sampling sleep and emits only approved status fields', async () => {
  let calls = 0;
  const lines: string[] = [];
  await sampleWaiting({ call: async () => { calls++; return { thread: { id: 'thread', status: { type: 'active', activeFlags: ['waitingOnApproval', 'PRIVATE'] } } }; }, close() {} },
    'thread', line => lines.push(line), 20, 60_000);
  assert.equal(calls, 1);
  assert.deepEqual(lines, ['{"type":"active","flags":["waitingOnApproval"]}']);
});

test('identity mismatch remains an error and releases the connection', async () => {
  let closed = false;
  await assert.rejects(sampleWaiting({ call: async () => ({ thread: { id: 'other' } }), close() { closed = true; } }, 'thread', () => {}), /identity mismatch/);
  assert.equal(closed, true);
});
