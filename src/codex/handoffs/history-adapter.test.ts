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
  snapshot.connection = {status:'connected',lastObservedAt:at,message:null};
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

test('empty startup enables after late arrivals, notifying capability without replaying their history',async t=>{
  const h=harness(); h.snapshot.agents=[];
  const adapter=await setup(h); t.after(()=>adapter.stop());
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported,false);
  await delay();
  assert.equal(h.events.length,0);
  for (const [index,id] of ['a','b'].entries()) h.emit({protocolVersion:1,bridgeEpoch:'base',seq:index+1,
    eventId:`arrival-${id}`,occurredAt:at,source:'codex',type:'agent.upserted',agentId:id,data:{agent:agent(id)}});
  await delay();
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported,true);
  const capabilities=h.events.filter(e=>e.type==='capabilities.changed');
  assert.equal(capabilities.length,1);
  assert.equal(capabilities[0].data.capabilities.observeHandoffs.supported,true);
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
  h.items.set('a',[item('old'),item('after-arrival')]); await delay();
  const handoffs=h.events.filter(e=>e.type==='handoff.observed');
  assert.equal(handoffs.length,1);
  assert.equal(handoffs[0].data.handoff.sourceItemId,'after-arrival');
});

test('reconnect history is seeded without meetings',async t=>{
  const h=harness(); const adapter=await setup(h); t.after(()=>adapter.stop());
  h.items.set('a',[item('old'),item('fresh')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  h.reconnect(); h.items.set('a',[item('old'),item('fresh'),item('during-disconnect')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,1);
  h.items.set('a',[item('old'),item('fresh'),item('during-disconnect'),item('after')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,2);
});

test('reader failure marks source unavailable and never emits later history',async t=>{
  const h=harness(); const adapter=await setup(h); t.after(()=>adapter.stop());
  h.fail('a'); await delay();
  const snapshot=await adapter.initialSnapshot();
  assert.equal(snapshot.capabilities.observeHandoffs.supported,false);
  assert.equal(snapshot.connection.status,'connected');
  const changed=h.events.filter(e=>e.type==='capabilities.changed');
  assert.equal(changed.length,1);
  assert.equal(changed[0].data.capabilities.observeHandoffs.supported,false);
  assert.equal(changed[0].agentId,null);
  h.recover('a'); h.items.set('a',[item('old'),item('missed')]);
  h.emit({protocolVersion:1,bridgeEpoch:'base',seq:1,eventId:'metadata-after-failure',occurredAt:at,source:'codex',
    type:'agent.upserted',agentId:'c',data:{agent:agent('c')}});
  await delay();
  assert.ok((await adapter.initialSnapshot()).agents.some(a=>a.agentId==='c'));
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
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

test('an observer gap exposes disconnected metadata and cannot falsely recover',async t=>{
  const h=harness(); const adapter=await setup(h); t.after(()=>adapter.stop());
  h.emit({protocolVersion:1,bridgeEpoch:'base',seq:2,eventId:'gap',occurredAt:at,source:'codex',
    type:'agent.upserted',agentId:'c',data:{agent:agent('c')}});
  assert.equal((await adapter.initialSnapshot()).connection.status,'disconnected');
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported,false);
  const disconnected=h.events.filter(e=>e.type==='connection.changed');
  assert.equal(disconnected.length,1);
  assert.equal(disconnected[0].data.connection.status,'disconnected');
  assert.match(disconnected[0].data.connection.message!,/continuity/);
  h.emit({protocolVersion:1,bridgeEpoch:'base',seq:3,eventId:'false-recovery',occurredAt:at,source:'codex',
    type:'connection.changed',agentId:null,data:{connection:{status:'connected',lastObservedAt:at,message:null}}});
  h.items.set('a',[item('old'),item('after-gap')]); await delay();
  assert.equal(h.events.filter(e=>e.type==='handoff.observed').length,0);
  assert.equal((await adapter.initialSnapshot()).connection.status,'disconnected');
  assert.equal(h.events.filter(e=>e.type==='connection.changed').length,1);
});

test('events buffered during initial snapshot preserve one wrapper clock',async t=>{
  const h=harness();
  let listener:(event:OfficeEvent)=>void=()=>{};
  let resolveSnapshot!:(snapshot:typeof h.snapshot)=>void;
  const pending=new Promise<typeof h.snapshot>(resolve=>{resolveSnapshot=resolve;});
  const base:OfficeAdapter={initialSnapshot:()=>pending,subscribe(fn){listener=fn;return()=>{};},stop(){}};
  const creating=createHandoffHistoryAdapter({base,reader:h.reader,sourceVerified:true,sourceNamespace:'verified-runtime',pollMs:10,now:()=>at});
  listener({protocolVersion:1,bridgeEpoch:'base',seq:1,eventId:'during-bootstrap',occurredAt:at,source:'codex',
    type:'agent.upserted',agentId:'c',data:{agent:agent('c')}});
  resolveSnapshot(h.snapshot);
  const adapter=await creating; t.after(()=>adapter.stop());
  const snapshot=await adapter.initialSnapshot();
  assert.ok(snapshot.agents.some(a=>a.agentId==='c'));
  assert.equal(snapshot.lastSeq,1);
});

test('missing reader generation preserves base metadata while capability stays unavailable',async t=>{
  const h=harness();
  const reader:VerifiedHistoryReader={generation:'',read:async()=>{ throw new Error('must not read'); },close(){}};
  const adapter=await createHandoffHistoryAdapter({base:h.base,reader,sourceVerified:true,sourceNamespace:'verified-runtime',pollMs:10});
  t.after(()=>adapter.stop());
  const snapshot=await adapter.initialSnapshot();
  assert.equal(snapshot.connection.status,'connected');
  assert.equal(snapshot.capabilities.observeHandoffs.supported,false);
  assert.equal(snapshot.agents.length,2);
});

test('connected message reflects handoff support initially and after metadata updates',async t=>{
  const h=harness(); h.snapshot.connection.message='Live metadata only.';
  const adapter=await setup(h); t.after(()=>adapter.stop());
  const message='Live agent metadata, completed command activity and observed message exchanges. Request details unavailable.';
  assert.equal((await adapter.initialSnapshot()).connection.message,message);
  h.emit({protocolVersion:1,bridgeEpoch:'base',seq:1,eventId:'metadata-connected',occurredAt:at,source:'codex',
    type:'connection.changed',agentId:null,data:{connection:{status:'connected',lastObservedAt:at,message:'Metadata refresh only.'}}});
  assert.equal((await adapter.initialSnapshot()).connection.message,message);
  const connected=h.events.find(e=>e.type==='connection.changed');
  assert.equal(connected?.data.connection.message,message);
  h.fail('a'); await delay();
  assert.equal((await adapter.initialSnapshot()).connection.message,'Metadata refresh only.');
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported,false);
});

test('completed commands add bounded private-safe recent activity without changing current work or replaying history', async t => {
  const command = (id: string, status = 'completed') => ({ type: 'commandExecution', id, status,
    command: 'SYNTHETIC_PRIVATE_COMMAND', aggregatedOutput: 'SYNTHETIC_PRIVATE_OUTPUT' });
  const h = harness();
  h.snapshot.agents[0].runtimeState = 'idle';
  h.items.set('a', [command('old'), command('in-progress', 'inProgress')]);
  h.items.set('outside', [command('out-of-scope')]);
  const adapter = await setup(h); t.after(() => adapter.stop());
  assert.deepEqual((await adapter.initialSnapshot()).agents.find(a => a.agentId === 'a')!.recentActivity, []);
  h.items.set('a', [command('old'), command('in-progress', 'inProgress'), command('fresh', 'failed')]);
  await delay();
  let current = (await adapter.initialSnapshot()).agents.find(a => a.agentId === 'a')!;
  assert.equal(current.recentActivity.length, 1);
  assert.equal(current.recentActivity[0].summary, 'Ran a command.');
  assert.equal(current.recentActivity[0].sourceItemId, null);
  assert.equal(current.runtimeState, 'idle');
  assert.equal(current.activityKind, 'unknown');
  assert.equal(h.events.some(e => e.type === 'agent.activity'), false);
  const originalActivity = current.recentActivity[0];
  const count = h.events.length;
  await delay(); assert.equal(h.events.length, count, 'poll replay is silent');
  h.emit({ protocolVersion: 1, bridgeEpoch: 'base', seq: 1, eventId: 'metadata', occurredAt: at, source: 'codex',
    type: 'agent.upserted', agentId: 'a', data: { agent: { ...agent('a'), runtimeState: 'waiting-for-approval', task: 'Observed task' } } });
  current = (await adapter.initialSnapshot()).agents.find(a => a.agentId === 'a')!;
  assert.deepEqual(current.recentActivity, [originalActivity]);
  assert.equal(current.runtimeState, 'waiting-for-approval');
  assert.equal(current.activityKind, 'unknown');

  h.reconnect();
  h.items.set('a', [command('old'), command('fresh', 'failed'), command('while-away')]);
  await delay();
  assert.deepEqual((await adapter.initialSnapshot()).agents.find(a => a.agentId === 'a')!.recentActivity, [originalActivity]);
  h.items.set('a', [command('old'), command('fresh', 'failed'), command('while-away'),
    ...Array.from({ length: 55 }, (_, i) => command(`after-${i}`))]);
  await delay();
  current = (await adapter.initialSnapshot()).agents.find(a => a.agentId === 'a')!;
  assert.equal(current.recentActivity.length, 50);
  assert.equal(new Set(current.recentActivity.map(activity => activity.activityId)).size, 50);
  assert.equal(current.runtimeState, 'waiting-for-approval');
  assert.equal(current.activityKind, 'unknown');
  assert.equal(h.events.some(e => e.agentId === 'outside'), false);

  h.items.set('late', [command('late-history')]);
  h.emit({ protocolVersion: 1, bridgeEpoch: 'base', seq: 2, eventId: 'late-agent', occurredAt: at, source: 'codex',
    type: 'agent.upserted', agentId: 'late', data: { agent: agent('late') } });
  await delay();
  assert.deepEqual((await adapter.initialSnapshot()).agents.find(a => a.agentId === 'late')!.recentActivity, []);
  const serialized = JSON.stringify([h.events, await adapter.initialSnapshot()]);
  assert.equal(serialized.includes('SYNTHETIC_PRIVATE'), false);
  assert.equal(serialized.includes('out-of-scope'), false);
});

test('capacity exhaustion during initial history fails closed and preserves metadata', async t => {
  const h = harness();
  h.items.set('a', Array.from({length: 10_001}, (_, i) => item('baseline-' + i)));
  const adapter = await setup(h); t.after(() => adapter.stop());
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.capabilities.observeHandoffs.supported, false);
  assert.match(snapshot.capabilities.observeHandoffs.reason!, /capacity/);
  assert.equal(snapshot.connection.status, 'connected');
  assert.equal(h.events.filter(e => e.type === 'handoff.observed').length, 0);
  h.emit({protocolVersion:1,bridgeEpoch:'base',seq:1,eventId:'metadata-after-capacity',occurredAt:at,source:'codex',
    type:'agent.upserted',agentId:'c',data:{agent:agent('c')}});
  assert.ok((await adapter.initialSnapshot()).agents.some(a => a.agentId === 'c'));
});

test('capacity exhaustion after startup revokes support without presenting the overflow', async t => {
  const h = harness();
  h.items.set('a', Array.from({length: 10_000}, (_, i) => item('baseline-' + i)));
  const adapter = await setup(h); t.after(() => adapter.stop());
  assert.equal((await adapter.initialSnapshot()).capabilities.observeHandoffs.supported, true);
  h.items.set('a', [...h.items.get('a')!, item('overflow')]);
  await delay(200);
  const snapshot = await adapter.initialSnapshot();
  assert.equal(snapshot.capabilities.observeHandoffs.supported, false);
  assert.match(snapshot.capabilities.observeHandoffs.reason!, /capacity/);
  assert.equal(snapshot.connection.status, 'connected');
  assert.equal(h.events.filter(e => e.type === 'handoff.observed').length, 0);
  assert.equal(h.events.filter(e => e.type === 'capabilities.changed').at(-1)?.data.capabilities.observeHandoffs.supported, false);
});
