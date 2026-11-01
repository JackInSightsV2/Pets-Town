import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from './live-handoff-adapter.js';
import { emptySnapshot, type OfficeEvent } from '../shared/contract.js';
import type { OfficeAdapter } from '../server/adapter.js';

test('failed optional Mac reader keeps metadata active and reports the handoff limitation', async () => {
  const initial = emptySnapshot('metadata');
  initial.connection = { status: 'connected', lastObservedAt: null, message: 'Metadata connected.' };
  let stopped = 0;
  let sink: (event: OfficeEvent) => void = () => {};
  const base: OfficeAdapter = {
    initialSnapshot: () => structuredClone(initial),
    subscribe(listener) { sink = listener; return () => { sink = () => {}; }; },
    stop() { stopped++; },
  };
  const adapter = await createAdapter({ createBase: async () => base,
    createReader: async () => { throw new Error('socket or version unavailable'); } });
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.connection.status, 'connected');
  assert.equal(snapshot.capabilities.observeHandoffs.supported, false);
  assert.match(snapshot.capabilities.observeHandoffs.reason!, /could not connect or verify/);
  let received = false;
  adapter.subscribe(event => { if (event.type === 'agent.closed') received = true; });
  sink({ protocolVersion: 1, bridgeEpoch: 'metadata', seq: 1, eventId: 'update',
    occurredAt: '2026-11-01T14:00:00Z', source: 'codex', agentId: 'existing',
    type: 'agent.closed', data: { reason: null } });
  assert.equal(received, true);
  assert.equal(stopped, 0);
  await adapter.stop();
  assert.equal(stopped, 1);
});
