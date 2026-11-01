import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddedController } from './controller';
import { snapshot, agent } from '../../client/test-helpers';
import { officeView } from '../snapshot';
import type { App } from '@modelcontextprotocol/ext-apps';

test('host refresh applies ordered live events without replaying the accompanying snapshot or messaging', async () => {
  const initial = snapshot(); initial.connection.status = 'connected'; initial.lastSeq = 0;
  const view = officeView(initial, ['/project']);
  const result = (office: object) => ({ _meta: { office } });
  let reply: unknown; let calls = 0;
  const host = { connect: async () => {}, close: async () => {}, getHostContext: () => ({}), getHostCapabilities: () => ({ serverTools: {} }),
    callServerTool: async () => { calls++; return reply; }, updateModelContext: () => { throw Error('unexpected context'); },
    sendMessage: () => { throw Error('unexpected message'); } } as unknown as App;
  Object.assign(globalThis, { window: { parent: {}, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} } });
  const controller = createEmbeddedController(host);
  host.ontoolresult!(result(view) as never); await controller.connect();
  const at = '2026-11-01T13:00:00Z';
  const envelope = { protocolVersion: 1 as const, bridgeEpoch: initial.bridgeEpoch, occurredAt: at, source: initial.source, agentId: 'main' };
  const obs = (status: 'started'|'succeeded', n: string) => ({ agentId: 'main', turnId: 'turn-v1-' + 'a'.repeat(64), sourceEventId: 'turn-event-v1-' + n.repeat(64), status, source: initial.source, delivery: 'live', occurredAt: at, startedAt: 1 });
  const events = [ { ...envelope, seq: 1, eventId: 'upsert', type: 'agent.upserted', data: { agent: agent('main') } },
    { ...envelope, seq: 2, eventId: 'start', type: 'agent.turn.observed', data: { observation: obs('started', 'b') } },
    { ...envelope, seq: 3, eventId: 'done', type: 'agent.turn.observed', data: { observation: obs('succeeded', 'c') } } ];
  reply = result({ ...view, snapshot: { ...view.snapshot, lastSeq: 3, agents: [] }, refresh: { mode: 'events', events } });
  await controller.refresh();
  assert.equal(controller.store.getState().snapshot?.lastSeq, 3);
  assert.equal(controller.store.getState().snapshot?.agents.length, 1);
  assert.equal(controller.lifecycle.getLifecycleState().sprites[0]?.phase, 'leaving');
  reply = result({ ...view, snapshot: { ...view.snapshot, lastSeq: 3 }, refresh: { mode: 'events', events: [] } });
  await controller.refresh();
  assert.equal(controller.lifecycle.getLifecycleState().sprites[0]?.phase, 'leaving');
  assert.equal(calls, 2);
  // A missing event must never partially apply a batch or claim continuity.
  reply = result({ ...view, snapshot: { ...view.snapshot, lastSeq: 5 }, refresh: { mode: 'events', events: [{ ...events[0], seq: 5 }] } });
  await controller.refresh();
  assert.equal(controller.store.getState().snapshot?.lastSeq, 3);
  assert.equal(controller.store.getState().transport.status, 'reconnecting');
  reply = result({ ...view, snapshot: { ...view.snapshot, bridgeEpoch: 'replacement', lastSeq: 0 }, refresh: { mode: 'baseline' } });
  await controller.refresh();
  assert.equal(controller.store.getState().snapshot?.bridgeEpoch, 'replacement');
  assert.equal(controller.store.getState().transport.status, 'connected');
  controller.stop();
});

