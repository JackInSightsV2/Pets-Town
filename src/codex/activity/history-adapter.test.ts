import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, type OfficeAgent, type OfficeEvent } from '../../shared/contract.js';
import type { OfficeAdapter } from '../../server/adapter.js';
import { createActivityHistoryAdapter } from './history-adapter.js';

const at = '2026-11-01T14:00:00Z';
const delay = () => new Promise(resolve => setTimeout(resolve, 45));
const agent: OfficeAgent = { agentId:'a', parentAgentId:null, projectId:'p', displayName:'Agent', role:null, task:null, runtimeState:'working', activityKind:'unknown', lastObservedAt:at, pendingRequestIds:[], petAssetId:null, recentActivity:[] };
const item = (id: string, status = 'completed') => ({ type:'commandExecution', id, status, command:'PRIVATE', output:'PRIVATE' });

test('history is silent; new commands appear once and survive metadata upserts and reconnect', async t => {
  const snapshot = emptySnapshot('base'); snapshot.agents = [agent]; snapshot.connection = { status:'connected', lastObservedAt:at, message:null };
  let sink: (event: OfficeEvent) => void = () => {};
  const base: OfficeAdapter = { initialSnapshot: () => structuredClone(snapshot), subscribe(fn) { sink=fn; return () => {}; }, stop() {} };
  let items = [item('old')], generation = 'one';
  const reader = { get generation() { return generation; }, async read(id:string) { return { thread:{ id, turns:[{ id:'turn', items }] } }; }, close() {} };
  const adapter = await createActivityHistoryAdapter({ base, reader, sourceNamespace:'runtime', pollMs:10, now:()=>at });
  t.after(() => adapter.stop());
  const events: OfficeEvent[] = []; adapter.subscribe(e => events.push(e));
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length, 0);
  items = [item('old'), item('new')]; await delay();
  assert.equal(events.filter(e => e.type === 'agent.activity').length, 1);
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
  sink({ protocolVersion:1, bridgeEpoch:'base', seq:1, eventId:'upsert', occurredAt:at, source:'codex', type:'agent.upserted', agentId:'a', data:{ agent } });
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length, 1);
  generation = 'two'; items = [item('old'), item('new'), item('during-reconnect')]; await delay();
  assert.equal(events.filter(e => e.type === 'agent.activity').length, 1);
  items.push(item('after-reconnect')); await delay();
  assert.equal(events.filter(e => e.type === 'agent.activity').length, 2);
  assert.equal(events.some(e => e.type === 'agent.work.completed'), false);
});

test('in-progress and unknown items cannot fabricate completed activity', async t => {
  const snapshot = emptySnapshot('base'); snapshot.agents=[agent]; snapshot.connection={status:'connected', lastObservedAt:at, message:null};
  const base: OfficeAdapter = {initialSnapshot:()=>snapshot, subscribe:()=>()=>{}, stop(){}};
  let items: unknown[] = [];
  const reader = { generation:'one', async read(id:string) { return {thread:{id,turns:[{id:'turn',items}]}}; }, close(){} };
  const adapter = await createActivityHistoryAdapter({base, reader, sourceNamespace:'runtime', pollMs:10, now:()=>at}); t.after(()=>adapter.stop());
  const events: OfficeEvent[]=[]; adapter.subscribe(e=>events.push(e));
  items=[item('pending','inProgress'), {type:'mcpToolCall',id:'other',status:'completed'}]; await delay();
  assert.equal(events.length,0);
  items=[item('pending','failed')]; await delay();
  assert.equal(events.filter(e=>e.type==='agent.activity').length,1);
});
