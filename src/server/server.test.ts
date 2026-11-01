import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptySnapshot, type OfficeEvent } from '../shared/contract.js';
import { createOfficeServer } from './server.js';
import type { OfficeAdapter } from './adapter.js';
import { createOfficeStore } from '../client/store.js';
import { isOfficeEvent } from '../client/validation.js';

function adapter() {let listener:(event:OfficeEvent)=>void=()=>{};let stopped=false;return {source:{initialSnapshot:()=>emptySnapshot(),subscribe(fn){listener=fn;return()=>{listener=()=>{};};},stop(){stopped=true;}} satisfies OfficeAdapter,emit:(event:OfficeEvent)=>listener(event),stopped:()=>stopped};}
function event(type:string,data:unknown,id=crypto.randomUUID()):OfficeEvent {return {protocolVersion:1,bridgeEpoch:'adapter',seq:12,eventId:id,occurredAt:'2026-11-01T13:00:00Z',source:'codex',agentId:'real-agent',type,data} as OfficeEvent;}

test('unknown runtime is honestly empty and shutdown stops adapter',async()=>{const a=adapter();const server=await createOfficeServer({adapter:a.source});const snapshot=await (await fetch(server.url+'/api/office')).json();assert.equal(snapshot.connection.status,'unsupported');assert.deepEqual(snapshot.agents,[]);assert.equal(snapshot.source,'codex');assert.ok(snapshot.controlToken);await server.close();assert.ok(a.stopped());await assert.rejects(fetch(server.url+'/api/health'));});

test('presentation requires token/same origin and is idempotent; requests persist until exact resolution',async(t)=>{
  const a=adapter();const server=await createOfficeServer({adapter:a.source,presentationStepMs:60000});t.after(()=>server.close());
  const snapshot=await (await fetch(server.url+'/api/office')).json();
  const post=(action:string,headers:Record<string,string>={})=>fetch(server.url+'/api/'+action,{method:'POST',headers});
  assert.equal((await post('presentation/start')).status,403);
  const headers={'X-Office-Token':snapshot.controlToken};
  assert.equal((await post('presentation/start',{...headers,Origin:'https://evil.example'})).status,403);
  assert.equal(await new Promise<number|undefined>(done=>{const req=request(server.url+'/api/presentation/start',{method:'POST',headers:{...headers,Host:'evil.example'}},res=>{res.resume();done(res.statusCode);});req.end();}),403);
  const first=await (await post('presentation/start',headers)).json();const second=await (await post('presentation/start',headers)).json();assert.deepEqual(first,second);
  a.emit(event('request.opened',{request:{requestId:'request-1',agentId:'real-agent',kind:'user-input',prompt:'Observed question',options:[],createdAt:'2026-11-01T13:00:00Z',responseCapability:{supported:true,reason:null},revision:null}}));
  await post('presentation/skip',headers);await post('presentation/reset',headers);
  let current=await (await fetch(server.url+'/api/office')).json();assert.equal(current.pendingRequests.length,1);assert.equal(current.pendingRequests[0].responseCapability.supported,false);
  assert.equal((await post('requests/request-1/respond',headers)).status,501);
  a.emit(event('request.resolved',{requestId:'unrelated',reason:null}));current=await (await fetch(server.url+'/api/office')).json();assert.equal(current.pendingRequests.length,1);
  a.emit(event('request.resolved',{requestId:'request-1',reason:'Answered elsewhere'}));current=await (await fetch(server.url+'/api/office')).json();assert.equal(current.pendingRequests.length,0);
});

test('SSE replays bridge sequence and rejects gaps/epochs without mutating runtime state',{timeout:5000},async(t)=>{
  const a=adapter();const server=await createOfficeServer({adapter:a.source,replayLimit:2});t.after(()=>server.close());
  const initial=await (await fetch(server.url+'/api/office')).json();
  for(let i=0;i<3;i++)a.emit(event('connection.changed',{connection:{status:'disconnected',lastObservedAt:null,message:'Observed disconnect'}}));
  assert.equal((await fetch(server.url+`/api/events?cursor=${initial.bridgeEpoch}:0`)).status,409);
  assert.equal((await fetch(server.url+'/api/events?cursor=old:1')).status,409);
  assert.equal((await fetch(server.url+`/api/events?cursor=${initial.bridgeEpoch}:999`)).status,409);
  const abort=new AbortController();const response=await fetch(server.url+'/api/events',{headers:{'Last-Event-ID':`${initial.bridgeEpoch}:1`},signal:abort.signal});assert.equal(response.status,200);
  const reader=response.body!.getReader();let text='';const decoder=new TextDecoder();while(!text.includes('\"seq\":3')){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});}assert.match(text,/event: office/);assert.match(text, new RegExp(`${initial.bridgeEpoch}:2`));assert.match(text, /"seq":3/);await reader.cancel();abort.abort();
});

test('static files only from dist or approved office asset; symlink traversal rejected',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'office-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const dist=join(dir,'dist');await import('node:fs/promises').then(fs=>fs.mkdir(dist));await writeFile(join(dist,'index.html'),'<h1>Office</h1>');await writeFile(join(dir,'secret'),'private');await symlink(join(dir,'secret'),join(dist,'leak'));
  const server=await createOfficeServer({distDir:dist});t.after(()=>server.close());
  assert.match(await (await fetch(server.url)).text(),/Office/);assert.equal((await fetch(server.url+'/leak')).status,403);assert.equal((await fetch(server.url+'/%2e%2e%2fsecret')).status,403);assert.equal((await fetch(server.url+'/api/start')).status,404);
});

test('detail-free pending IDs survive presentation and metadata changes; malformed events are ignored',async(t)=>{
  const a=adapter();const server=await createOfficeServer({adapter:a.source,presentationStepMs:60000});t.after(()=>server.close());
  const agent={agentId:'real-agent',parentAgentId:null,projectId:'project',displayName:'Existing agent',role:null,task:null,runtimeState:'waiting-for-input',activityKind:'unknown',lastObservedAt:null,pendingRequestIds:['unknown-1','unknown-2'],petAssetId:null,recentActivity:[]};
  a.emit(event('agent.upserted',{agent}));
  const initial=await (await fetch(server.url+'/api/office')).json();
  for(const action of ['start','reset'])await fetch(server.url+'/api/presentation/'+action,{method:'POST',headers:{'X-Office-Token':initial.controlToken}});
  a.emit(event('agent.upserted',{agent:{...agent,pendingRequestIds:[]}}));
  a.emit(event('agent.activity',{activity:{activityId:'a',agentId:'real-agent',kind:'reading',summary:'Observed activity',occurredAt:'2026-11-01T13:00:00Z',sourceItemId:null,source:'codex'}}));
  a.emit(event('request.opened',{}));a.emit(null as unknown as OfficeEvent);
  let current=await (await fetch(server.url+'/api/office')).json();assert.deepEqual(current.agents[0].pendingRequestIds,['unknown-1','unknown-2']);
  const wrongOwner=event('request.resolved',{requestId:'unknown-1',reason:null});wrongOwner.agentId='other-agent';a.emit(wrongOwner);
  current=await (await fetch(server.url+'/api/office')).json();assert.deepEqual(current.agents[0].pendingRequestIds,['unknown-1','unknown-2']);
  a.emit(event('request.resolved',{requestId:'unknown-1',reason:null}));
  current=await (await fetch(server.url+'/api/office')).json();assert.deepEqual(current.agents[0].pendingRequestIds,['unknown-2']);
  const fixture=event('agent.state.changed',{runtimeState:'idle'});fixture.source='fixture';a.emit(fixture);
  current=await (await fetch(server.url+'/api/office')).json();assert.equal(current.source,'fixture');
});

test('malformed observations are observable and preserve requests; local pet serving uses explicit allowlist',async(t)=>{
  const a=adapter();const dir=await mkdtemp(join(tmpdir(),'office-pets-'));t.after(()=>rm(dir,{recursive:true,force:true}));const pet=join(dir,'pet.webp');await writeFile(pet,'approved-asset');
  const server=await createOfficeServer({adapter:a.source,petAssetFiles:{approved:pet}});t.after(()=>server.close());
  a.emit(event('request.opened',{request:{requestId:'r',agentId:'real-agent',kind:'user-input',prompt:'Question',options:[],createdAt:'2026-11-01T13:00:00Z',responseCapability:{supported:false,reason:'Unsupported'},revision:null}}));
  for(const malformed of [event('agent.activity',{activity:{}}),event('agent.upserted',{agent:{pendingRequestIds:[7]}}),event('connection.changed',{connection:{status:'connected',message:7}}),event('request.resolved',{requestId:1,reason:null})])a.emit(malformed);
  const circular=event('request.resolved',{requestId:'r',reason:null});(circular as unknown as Record<string,unknown>).extra=circular;a.emit(circular);
  const health=await (await fetch(server.url+'/api/health')).json();assert.equal(health.adapterErrors,5);
  const snapshot=await (await fetch(server.url+'/api/office')).json();assert.equal(snapshot.pendingRequests.length,1);assert.match(snapshot.connection.message,/invalid adapter observation/);
  assert.equal(await (await fetch(server.url+'/pet-assets/approved')).text(),'approved-asset');assert.equal((await fetch(server.url+'/pet-assets/pet.webp')).status,404);assert.equal((await fetch(server.url+'/pet-assets/%2e%2e%2fpet.webp')).status,404);
});

test('explicit fixture has official assets and labelled deterministic event trace',async()=>{
  const {createFixtureAdapter}=await import('./fixture.js');const fixture=createFixtureAdapter(1);const snapshot=await fixture.initialSnapshot();assert.equal(snapshot.source,'fixture');assert.equal(snapshot.petAssets.length,3);assert.ok(snapshot.agents.every(agent=>snapshot.petAssets.some(pet=>pet.assetId===agent.petAssetId)));
  const received:OfficeEvent[]=[];await new Promise<void>(done=>{fixture.subscribe(event=>{received.push(event);if(received.length===7)done();});});await fixture.stop();assert.ok(received.every(event=>event.source==='fixture'));assert.deepEqual(received.map(event=>event.type),['agent.activity','handoff.observed','request.resolved','agent.work.completed','agent.state.changed','connection.changed','connection.changed']);
});

test('bootstrap buffers request events while initial snapshot is pending',async(t)=>{
  let listener:(event:OfficeEvent)=>void=()=>{};
  const source:OfficeAdapter={subscribe(fn){listener=fn;return()=>{};},async initialSnapshot(){const snapshot=emptySnapshot('adapter');await Promise.resolve();listener(event('request.opened',{request:{requestId:'during-bootstrap',agentId:'real-agent',kind:'user-input',prompt:'Observed',options:[],createdAt:'2026-11-01T13:00:00Z',responseCapability:{supported:false,reason:'Unsupported'},revision:null}}));return snapshot;},stop(){}};
  const server=await createOfficeServer({adapter:source});t.after(()=>server.close());const snapshot=await (await fetch(server.url+'/api/office')).json();assert.equal(snapshot.pendingRequests[0].requestId,'during-bootstrap');assert.equal(snapshot.lastSeq,1);
});


test('a project discovered after bootstrap reaches the browser store through SSE', async t => {
  const a = adapter(); const server = await createOfficeServer({ adapter: a.source });
  t.after(() => server.close());
  const initial = await (await fetch(server.url + '/api/office')).json();
  const store = createOfficeStore(initial);
  const project = { projectId: 'new-project', displayName: 'New project', cwd: '/new-project' };
  a.emit({ ...event('project.upserted', { project }), agentId: null });
  const response = await fetch(server.url + `/api/events?cursor=${initial.bridgeEpoch}:0`, { signal: AbortSignal.timeout(3000) });
  const reader = response.body!.getReader();
  try {
    let chunk = ''; const decoder = new TextDecoder();
    while (!chunk.includes('data: ') || !chunk.slice(chunk.indexOf('data: ')).includes('\n\n')) {
      const next = await reader.read(); if (next.done) break; chunk += decoder.decode(next.value, { stream: true });
    }
    const line = chunk.split('\n').find(line => line.startsWith('data: '));
    assert.ok(line);
    const delivered: unknown = JSON.parse(line.slice(6));
    assert.ok(isOfficeEvent(delivered));
    store.applyEvent(delivered);
    assert.deepEqual(store.getState().snapshot!.projects, [project]);
    const latest = await (await fetch(server.url + '/api/office')).json();
    assert.deepEqual(latest.projects, [project]);
  } finally { await reader.cancel(); }
});

test('capability loss/recovery reaches snapshot and SSE while replies stay disabled and malformed updates are rejected', async t => {
  const a = adapter(); const server = await createOfficeServer({ adapter: a.source });
  t.after(() => server.close());
  a.emit(event('request.opened', { request: { requestId: 'pending', agentId: 'real-agent', kind: 'user-input', prompt: 'Synthetic question',
    options: [], createdAt: '2026-11-01T13:00:00Z', responseCapability: { supported: true, reason: null }, revision: null } }));
  const initial = await (await fetch(server.url + '/api/office')).json();
  const store = createOfficeStore(initial);
  for (const supported of [true, false, true]) {
    const capabilities = { observeAgents: { supported: true, reason: null },
      observeHandoffs: { supported, reason: supported ? null : 'History unavailable.' }, respondToRequests: { supported: true, reason: null } };
    a.emit({ ...event('capabilities.changed', { capabilities }), agentId: null });
    const current = await (await fetch(server.url + '/api/office')).json();
    assert.deepEqual(current.capabilities.observeHandoffs, capabilities.observeHandoffs);
    assert.equal(current.capabilities.respondToRequests.supported, false);
    assert.equal(current.pendingRequests[0].requestId, 'pending');
    assert.equal(current.pendingRequests[0].responseCapability.supported, false);
    assert.equal(capabilities.respondToRequests.supported, true);
  }
  const response = await fetch(server.url + `/api/events?cursor=${initial.bridgeEpoch}:${initial.lastSeq}`, { signal: AbortSignal.timeout(3000) });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder(); let buffer = ''; const observed: boolean[] = [];
  try {
    while (observed.length < 3) {
      const chunk = await reader.read(); assert.equal(chunk.done, false);
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const line = frame.split('\n').find(line => line.startsWith('data: '));
        if (!line) continue;
        const delivered: unknown = JSON.parse(line.slice(6)); assert.ok(isOfficeEvent(delivered));
        store.applyEvent(delivered);
        if (delivered.type === 'capabilities.changed') {
          assert.equal(delivered.agentId, null);
          assert.equal(delivered.data.capabilities.respondToRequests.supported, false);
          observed.push(store.getState().snapshot!.capabilities.observeHandoffs.supported);
        }
      }
    }
  } finally { await reader.cancel(); }
  assert.deepEqual(observed, [true, false, true]);
  const before = await (await fetch(server.url + '/api/office')).json();
  a.emit({ ...event('capabilities.changed', { capabilities: { observeAgents: { supported: true, reason: null } } }), agentId: null });
  a.emit(event('capabilities.changed', { capabilities: before.capabilities }));
  const after = await (await fetch(server.url + '/api/office')).json();
  assert.deepEqual(after.capabilities, before.capabilities);
  assert.deepEqual(after.pendingRequests, before.pendingRequests);
  assert.equal((await (await fetch(server.url + '/api/health')).json()).adapterErrors, 2);
});
