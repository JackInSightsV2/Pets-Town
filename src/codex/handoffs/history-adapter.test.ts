import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, type OfficeAgent, type OfficeEvent } from '../../shared/contract.js';
import type { OfficeAdapter } from '../../server/adapter.js';
import { createHandoffHistoryAdapter, type VerifiedHistoryReader } from './history-adapter.js';

const at = '2026-11-01T14:00:00Z';
const delay = (ms = 35) => new Promise(resolve => setTimeout(resolve, ms));
const agent = (id: string): OfficeAgent => ({ agentId:id, parentAgentId:null, projectId:'p', displayName:id,
  role:null, task:null, runtimeState:'working', activityKind:'unknown', lastObservedAt:at, pendingRequestIds:[], petAssetId:null, recentActivity:[] });
const item = (id: string, to = 'b') => ({ type:'subAgentActivity', kind:'interacted', id, agentThreadId:to });
function harness() {
  const snapshot = emptySnapshot('base');
  snapshot.agents = [agent('a'), agent('b')];
  const events: OfficeEvent[] = [];
  let sink:(event: OfficeEvent)=>void = () => {};
  const base: OfficeAdapter = { initialSnapshot:()=>structuredClone(snapshot), subscribe(fn){sink=fn; return()=>{sink=()=>{};};}, stop(){} };
  const emit = (event: OfficeEvent) => sink(event);
  let generation = 'generation-1';
  const items = new Map<string, unknown[]>([['a',[item('old')]],['b',[]]]);
  let failures = new Set<string>();
  let closes = 0;
  const reader: VerifiedHistoryReader = {
    get generation() { return generation; },
    async read(threadId) {
      if (failures.has(threadId)) throw new Error('not readable');
      return {thread:{id:threadId,turns:[{id:'turn',items:items.get(threadId) ?? []}]}};
    },
    close(){closes++;},
  };
  return {base,reader,snapshot,items,events,emit,closes:()=>closes,
    reconnect(){generation='generation-2';}, fail(id:string){failures.add(id);}, recover(id:string){failures.delete(id);} };
}
async function setup(h: ReturnType<typeof harness>, verified = true) {
  const adapter = await createHandoffHistoryAdapter({base:h.base, reader:h.reader, sourceVerified:verified,
    sourceNamespace:'verified-runtime', pollMs:10, now:()=>at});
  adapter.subscribe(event=>h.events.push(event));
  return adapter;
}
test('initial history is silent, new send preserves exact pair and source identity, replay suppressed', async t => {
  const h = harness(); const adapter = await setup(h); t.after(()=>adapter.stop());
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.capabilities.observeHandoffs.supported,true);
  assert.equal(snapshot.recentHandoffs.length,0);
  h.items.set('a',[item('old'),item('new')]); await delay();
  const handoffs=h.events.filter(e=>e.type==='handoff.observed');
  assert.equal(handoffs.length,1);
  const e=handoffs[0]; if(e.type!=='handoff.observed') throw Error();
  assert.equal(e.data.handoff.sourceItemId,'new'); assert.equal(e.agentId,'a'); assert.equal(e.data.handoff.toAgentId,'b');
  assert.equal(e.eventId,e.data.handoff.handoffId);
  await delay(); assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  const current=await adapter.initialSnapshot();
  assert.equal(current.lastSeq,e.seq); assert.equal(current.recentHandoffs[0].handoffId,e.eventId);
});

test('unverified and unreadable source cannot advertise support or emit', async t=>{
  const h=harness(); const adapter=await setup(h,false); t.after(()=>adapter.stop());
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported,false);
  h.items.set('a',[item('new')]); await delay(); assert.equal(h.events.length,0);
  const rejected=harness(); rejected.fail('a'); rejected.fail('b');
  const other=await setup(rejected,true); t.after(()=>other.stop());
  assert.equal((await other.initialSnapshot()).capabilities.observeHandoffs.supported,false);
});

test('late readable threads and reconnect history are seeded without meetings',async t=>{
  const h=harness(); h.fail('a'); const adapter=await setup(h); t.after(()=>adapter.stop());
  h.items.set('a',[item('old'),item('while-unreadable')]); h.recover('a'); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
  h.items.set('a',[item('old'),item('while-unreadable'),item('fresh')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  h.reconnect(); h.items.set('a',[item('old'),item('while-unreadable'),item('fresh'),item('during-disconnect')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  h.items.set('a',[item('old'),item('while-unreadable'),item('fresh'),item('during-disconnect'),item('after')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,2);
});

test('unscoped recipient stays unavailable even if it later joins roster',async t=>{
  const h=harness(); const adapter=await setup(h); t.after(()=>adapter.stop());
  h.items.set('a',[item('old'),item('external','c')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
  const event:OfficeEvent={protocolVersion:1,bridgeEpoch:'base',seq:1,eventId:'new-agent',occurredAt:at,source:'codex',
    type:'agent.upserted',agentId:'c',data:{agent:agent('c')}};
  h.emit(event); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
  h.items.set('a',[item('old'),item('external','c'),item('new-c','c')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  const state=await adapter.initialSnapshot(); assert.deepEqual(state.agents.map(a=>a.agentId).sort(),['a','b','c']);
});

test('stop detaches observer and closes reader only once',async()=>{
  const h=harness(); const adapter=await setup(h); await adapter.stop(); await adapter.stop();
  assert.equal(h.closes(),1);
  h.items.set('a',[item('fresh')]); await delay(); assert.equal(h.events.length,0);
});
