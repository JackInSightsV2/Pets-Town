import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import { snapshot,agent,event } from '../../client/test-helpers.js';
import { normalizeTurnLifecycle } from './normalizer.js';
import { createWindowsTurnLifecycleAdapter,type LifecycleScan } from './windows-adapter.js';
const sleep=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
function observation(status:string,turnId='turn-a',agentId='main',delivery:'live'|'history'='live') {
  const startedAt=turnId==='old'?50:turnId==='b'?200:turnId==='c'?300:100;
  const result=normalizeTurnLifecycle({source:'codex',sourceNamespace:'test',threadId:agentId,agentId,observedAt:'2026-01-01T00:00:00Z',delivery,format:'notification',value:{method:status==='inProgress'?'turn/started':'turn/completed',params:{threadId:agentId,turn:{id:turnId,status,startedAt}}}});
  if(result.kind!=='observed')throw new Error('Invalid synthetic observation');return result.observation;
}
function harness(initial?:OfficeSnapshot) {
  let listener=(event:OfficeEvent)=>{};let closed=0,baseStopped=0;
  let next:LifecycleScan={observations:[],latestTurns:[],quarantined:0};
  const state=initial??{...snapshot(),source:'codex' as const};
  const base:OfficeAdapter={initialSnapshot:()=>state,subscribe(fn){listener=fn;return()=>{listener=()=>{};};},stop(){baseStopped++;}};
  return {base,reader:{async scan(){const result=next;next={...next,observations:[]};return result;},close(){closed++;}},
    set(value:LifecycleScan){next=value;},emit:()=>listener,counts:()=>({closed,baseStopped})};
}
async function waitFor(check:()=>boolean){const deadline=Date.now()+3000;while(!check()&&Date.now()<deadline)await sleep();assert.ok(check());}
test('Windows composition seeds old outcome silently and carries all live outcomes without runtime mutation',async t=>{
  const h=harness();h.set({observations:[observation('completed','old','main','history')],latestTurns:[observation('completed','old','main','history')],quarantined:0});
  const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));
  assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].status,'succeeded');assert.equal(events.length,0);
  const cases=[['inProgress','a'],['completed','a'],['inProgress','b'],['failed','b'],['inProgress','c'],['interrupted','c']];
  for(const [status,id] of cases){const row=observation(status,id);h.set({observations:[row],latestTurns:[row],quarantined:0});await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'&&e.data.observation.sourceEventId===row.sourceEventId));}
  assert.deepEqual(events.filter(e=>e.type==='agent.turn.observed').map(e=>e.data.observation.status),['started','succeeded','started','failed','started','interrupted']);
  assert.equal((await adapter.initialSnapshot()).agents[0].runtimeState,'working');
});
test('new source agent waits for roster discovery, then its fresh start arrives',async t=>{
  const h=harness();const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));
  const row=observation('inProgress','child-turn','child');h.set({observations:[row],latestTurns:[row],quarantined:0});await sleep(40);
  assert.equal(events.length,0);h.emit()(event(1,'agent.upserted',{agent:agent('child')},{agentId:'child',source:'codex'}));
  await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'));
  const delivered=events.find(e=>e.type==='agent.turn.observed')!;assert.equal(delivered.data.observation.delivery,'live');
});
test('disconnect catch-up is silent history and optional scan failure preserves metadata',async t=>{
  const h=harness();const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));
  const started=observation('inProgress');h.set({observations:[started],latestTurns:[started],quarantined:0});await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'));
  h.emit()(event(1,'connection.changed',{connection:{status:'disconnected',lastObservedAt:null,message:null}},{source:'codex'}));
  const ended=observation('interrupted');h.set({observations:[ended],latestTurns:[ended],quarantined:0});
  h.emit()(event(2,'connection.changed',{connection:{status:'connected',lastObservedAt:null,message:null}},{source:'codex'}));
  await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'&&e.data.observation.status==='interrupted'));
  const delivered=events.find((e):e is Extract<OfficeEvent,{type:'agent.turn.observed'}>=>e.type==='agent.turn.observed'&&e.data.observation.status==='interrupted')!;
  assert.equal(delivered.data.observation.delivery,'history');assert.equal((await adapter.initialSnapshot()).connection.status,'connected');
});
test('continuity loss rejects later base updates and shutdown is idempotent',async()=>{
  const h=harness();const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});
  h.emit()(event(2,'agent.state.changed',{runtimeState:'idle'},{source:'codex'}));
  assert.equal((await adapter.initialSnapshot()).connection.status,'disconnected');
  assert.equal((await adapter.initialSnapshot()).agents[0].runtimeState,'working');
  await adapter.stop();await adapter.stop();assert.deepEqual(h.counts(),{closed:1,baseStopped:1});
});
test('pending source truth cannot regress before a newly discovered agent joins the roster',async t=>{
  for(const startedAt of [null,200,100]) {
    const h=harness();const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());
    const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));
    const newer=observation('inProgress','b','child');h.set({observations:[newer],latestTurns:[newer],quarantined:0});await sleep(40);
    const old={...observation('completed','a','child'),startedAt};h.set({observations:[old],latestTurns:[newer],quarantined:0});await sleep(40);
    h.emit()(event(1,'agent.upserted',{agent:agent('child')},{agentId:'child',source:'codex'}));
    await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'));
    const delivered=events.find(e=>e.type==='agent.turn.observed')!;
    assert.equal(delivered.data.observation.turnId,newer.turnId);assert.equal(delivered.data.observation.status,'started');assert.equal(delivered.data.observation.delivery,'live');
    await adapter.stop();
  }
});
test('a lifecycle-capable base cannot forward a stale observation rejected by latest snapshot truth',async t=>{
  const initial={...snapshot(),source:'codex' as const,latestTurns:[observation('inProgress','b')]};
  const h=harness(initial);const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());
  const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));
  h.emit()(event(1,'agent.turn.observed',{observation:observation('completed','a')},{source:'codex'}));
  assert.deepEqual(events,[]);assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].turnId,initial.latestTurns[0].turnId);
});
test('unorderable historical outcome cannot poison a later genuine known start',async t=>{
  const h=harness();const unknown={...observation('completed','old'),startedAt:null,delivery:'history' as const};
  h.set({observations:[],latestTurns:[unknown],quarantined:0});
  const adapter=await createWindowsTurnLifecycleAdapter({...h,pollMs:10});t.after(()=>adapter.stop());
  assert.deepEqual((await adapter.initialSnapshot()).latestTurns,[]);
  const events:OfficeEvent[]=[];adapter.subscribe(e=>events.push(e));const fresh=observation('inProgress','a');
  h.set({observations:[fresh],latestTurns:[fresh],quarantined:0});await waitFor(()=>events.some(e=>e.type==='agent.turn.observed'));
  assert.equal((await adapter.initialSnapshot()).latestTurns?.[0].turnId,fresh.turnId);
});
