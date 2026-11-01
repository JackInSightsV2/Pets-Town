import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAdapter } from './adapter.js';
import type { OfficeEvent } from '../shared/contract.js';
import { createOfficeServer } from './server.js';
import { createOfficeStore } from '../client/store.js';
import { snapshot, event } from '../client/test-helpers.js';
import { normalizeTurnLifecycle } from '../codex/lifecycle/normalizer.js';

const turn=()=>{
  const result=normalizeTurnLifecycle({source:'fixture',sourceNamespace:'test',threadId:'main',agentId:'main',delivery:'live',observedAt:'2026-01-01T00:00:00Z',format:'notification',
    value:{method:'turn/completed',params:{threadId:'main',turn:{id:'synthetic-turn',status:'interrupted'}}}});
  if(result.kind!=='observed')throw new Error('Invalid synthetic observation');
  return result.observation;
};
test('terminal observation crosses HTTP snapshot, SSE and client store without closing the session',async t=>{
  let receive=(event:OfficeEvent)=>{};
  const initial=snapshot(); initial.agents[0].pendingRequestIds=['pending'];
  const adapter:OfficeAdapter={initialSnapshot:()=>initial,subscribe(listener){receive=listener;return()=>{};},stop(){}};
  const server=await createOfficeServer({adapter});t.after(()=>server.close());
  const before=await(await fetch(server.url+'/api/office')).json();
  const store=createOfficeStore(before);store.selectAgent('main');
  receive(event(1,'agent.turn.observed',{observation:turn()}));
  const response=await fetch(server.url+`/api/events?cursor=${before.bridgeEpoch}:0`,{signal:AbortSignal.timeout(3000)});
  const reader=response.body!.getReader();
  try{const chunk=new TextDecoder().decode((await reader.read()).value);const line=chunk.split('\n').find(row=>row.startsWith('data: '));assert.ok(line);store.applyEvent(JSON.parse(line.slice(6)));}finally{await reader.cancel();}
  const current=await(await fetch(server.url+'/api/office')).json();
  assert.equal(current.latestTurns[0].status,'interrupted');
  assert.deepEqual(current.agents,before.agents);assert.deepEqual(store.getState().snapshot?.latestTurns,current.latestTurns);
  assert.equal(store.getState().selectedAgentId,'main');
  const ghost={...turn(),agentId:'missing'};receive(event(2,'agent.turn.observed',{observation:ghost},{agentId:'missing'}));
  assert.equal((await(await fetch(server.url+'/api/office')).json()).latestTurns.length,1);
});
test('invalid lifecycle baseline is rejected before serving an invalid snapshot',async()=>{
  const initial=snapshot();initial.latestTurns=[{...turn(),agentId:'missing'}];let stopped=false;
  const adapter:OfficeAdapter={initialSnapshot:()=>initial,subscribe(){return()=>{};},stop(){stopped=true;}};
  await assert.rejects(createOfficeServer({adapter}),/Invalid lifecycle snapshot/);assert.equal(stopped,true);
});
test('server snapshot cannot be replaced by an old turn with null or equal start time',async t=>{
  let receive=(event:OfficeEvent)=>{};const initial=snapshot();
  const newer={...turn(),turnId:`turn-v1-${'a'.repeat(64)}`,sourceEventId:`turn-event-v1-${'a'.repeat(64)}`,status:'started' as const,startedAt:200};
  initial.latestTurns=[newer];
  const adapter:OfficeAdapter={initialSnapshot:()=>initial,subscribe(listener){receive=listener;return()=>{};},stop(){}};
  const server=await createOfficeServer({adapter});t.after(()=>server.close());
  for(const [index,startedAt] of [null,200,100].entries())receive(event(index+1,'agent.turn.observed',{observation:{...turn(),startedAt}}));
  const current=await(await fetch(server.url+'/api/office')).json();assert.deepEqual(current.latestTurns,[newer]);
});
