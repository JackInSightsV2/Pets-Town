import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, type OfficeAgent, type OfficeEvent, type OfficeSnapshot } from '../../shared/contract.js';
import type { OfficeAdapter } from '../../server/adapter.js';
import { createOfficeServer } from '../../server/server.js';
import { createHandoffController } from '../../office/handoffs/controller.js';
import { HandoffNormalizer, type HandoffObservation } from './normalizer.js';

// Synthetic source-shaped evidence through the actual HTTP/SSE bridge, never a live trace.
test('synthetic send keeps source correlation through HTTP/SSE and creates exactly one meeting', async t => {
  const at = '2026-11-01T13:00:00Z';
  const snapshot = emptySnapshot('synthetic-adapter');
  snapshot.source = 'fixture';
  snapshot.capabilities.observeHandoffs = { supported: true, reason: null };
  snapshot.agents = ['sender', 'recipient'].map((agentId): OfficeAgent => ({
    agentId, parentAgentId: null, projectId: 'fixture-project', displayName: agentId,
    role: null, task: null, runtimeState: 'working', activityKind: 'communicating',
    lastObservedAt: at, pendingRequestIds: [], petAssetId: null, recentActivity: [],
  }));
  let emit: (event: OfficeEvent) => void = () => {};
  const adapter: OfficeAdapter = {
    initialSnapshot: () => snapshot,
    subscribe(listener) { emit = listener; return () => { emit = () => {}; }; },
    stop() {},
  };
  const server = await createOfficeServer({ adapter, presentationStepMs: 60_000 });
  t.after(() => server.close());
  const initial = await (await fetch(server.url + '/api/office')).json() as OfficeSnapshot;
  for (const action of ['start', 'skip']) {
    const response = await fetch(server.url + '/api/presentation/' + action, {
      method: 'POST', headers: { 'X-Office-Token': initial.controlToken! },
    });
    assert.equal(response.status, 200);
  }
  const live = await (await fetch(server.url + '/api/office')).json() as OfficeSnapshot;
  assert.equal(live.presentation.state, 'live');
  const controller = createHandoffController();
  controller.applySnapshot(live, ['sender', 'recipient']);
  const normalizer = new HandoffNormalizer();
  const observation: HandoffObservation = {
    source: 'fixture', sourceNamespace: 'synthetic-daemon', observedAt: at, delivery: 'live',
    notification: { method: 'item/completed', params: { threadId: 'sender', turnId: 'fixture-turn',
      item: { type: 'subAgentActivity', id: 'fixture-call', kind: 'interacted', agentThreadId: 'recipient' } } },
  };
  const result = normalizer.observe(observation);
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') throw new Error('Expected synthetic handoff.');
  const handoff = result.handoffs[0];
  const event: OfficeEvent = { protocolVersion: 1, bridgeEpoch: 'synthetic-adapter', seq: 1,
    eventId: handoff.handoffId, occurredAt: at, source: result.source, type: 'handoff.observed',
    agentId: handoff.fromAgentId, data: { handoff } };
  emit(event);
  emit(event); // Existing bridge eventId deduplication must also hold.
  const response = await fetch(server.url + '/api/events?cursor=' + live.bridgeEpoch + ':' + live.lastSeq,
    { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let wire = '';
  const decoder = new TextDecoder();
  let messages: OfficeEvent[] = [];
  try {
    while (messages.length === 0) {
      const chunk = await reader.read();
      if (chunk.done) break;
      wire += decoder.decode(chunk.value, { stream: true });
      messages = wire.split('\n\n').slice(0, -1)
        .flatMap(frame => frame.split('\n').filter(line => line.startsWith('data: ')))
        .map(line => JSON.parse(line.slice(6)) as OfficeEvent);
    }
  } finally { await reader.cancel(); }
  assert.equal(messages.length, 1);
  const delivered = messages[0];
  assert.equal(delivered.type, 'handoff.observed');
  assert.equal(delivered.bridgeEpoch, live.bridgeEpoch);
  assert.equal(delivered.seq, live.lastSeq + 1);
  assert.equal(delivered.source, 'fixture');
  if (delivered.type === 'handoff.observed') assert.deepEqual(delivered.data.handoff, handoff);
  controller.applyEvent(delivered);
  const starts = controller.drainEffects().filter(effect => effect.type === 'start');
  assert.equal(starts.length, 1);
  assert.deepEqual(controller.getState().active!.handoff, handoff);
  controller.applyEvent(delivered);
  assert.equal(controller.drainEffects().filter(effect => effect.type === 'start').length, 0);
  const current = await (await fetch(server.url + '/api/office')).json() as OfficeSnapshot;
  assert.equal(current.recentHandoffs.length, 1);
  controller.applySnapshot(current, ['sender', 'recipient']);
  controller.applyEvent(delivered);
  assert.equal(controller.getState().active, null);
  assert.equal(controller.drainEffects().filter(effect => effect.type === 'start').length, 0);
  const restored = new HandoffNormalizer({ checkpoint: normalizer.checkpoint() });
  assert.deepEqual(restored.observe(observation), { kind: 'ignored', reason: 'duplicate' });
});
