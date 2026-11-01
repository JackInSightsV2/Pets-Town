import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeStore } from './store.js';
import { event, snapshot } from './test-helpers.js';
import { normalizeTurnLifecycle } from '../codex/lifecycle/normalizer.js';

function observed(status = 'completed', agentId = 'main') {
  const result = normalizeTurnLifecycle({source:'fixture',sourceNamespace:'test',threadId:agentId,agentId,delivery:'live',observedAt:'2026-01-01T00:00:00Z',format:'notification',
    value:{method:status === 'inProgress'?'turn/started':'turn/completed',params:{threadId:agentId,turn:{id:'synthetic-turn',status,startedAt:100}}}});
  if(result.kind!=='observed')throw new Error('Invalid synthetic observation');
  return result.observation;
}
test('lifecycle wire updates latest presence without mutating runtime, requests or selection', () => {
  const initial=snapshot(); initial.agents[0].pendingRequestIds=['pending'];
  const store=createOfficeStore(initial); store.selectAgent('main');
  store.applyEvent(event(1,'agent.turn.observed',{observation:observed()}));
  assert.equal(store.getState().snapshot?.latestTurns?.[0].status,'succeeded');
  assert.deepEqual(store.getState().snapshot?.agents,initial.agents);
  assert.equal(store.getState().selectedAgentId,'main');
  store.applyEvent(event(2,'agent.turn.observed',{observation:observed('inProgress')}));
  assert.equal(store.getState().snapshot?.latestTurns?.[0].status,'succeeded');
  store.applyEvent(event(3,'agent.upserted',{agent:initial.agents[0]}));
  assert.equal(store.getState().snapshot?.latestTurns?.[0].status,'succeeded');
});
test('unknown roster owners and mismatched source do not enter lifecycle snapshots', () => {
  const store=createOfficeStore(snapshot());
  store.applyEvent(event(1,'agent.turn.observed',{observation:observed('completed','missing')},{agentId:'missing'}));
  const wrong={...observed(),source:'codex' as const};
  store.applyEvent(event(2,'agent.turn.observed',{observation:wrong},{source:'codex'}));
  assert.equal(store.getState().snapshot?.latestTurns,undefined);
  assert.equal(store.getState().snapshot?.lastSeq,2);
});
