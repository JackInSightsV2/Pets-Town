import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshot} from '../../client/test-helpers.js';
import {createOfficeStore} from '../../client/store.js';
import {isOfficeEvent} from '../../client/validation.js';
import {createOfficeServer} from '../../server/server.js';
import type {OfficeAdapter} from '../../server/adapter.js';
import {createTurnLifecycleController} from '../../office/lifecycle/controller.js';
import {RolloutLifecycleReader} from './rollout-reader.js';
import {createWindowsTurnLifecycleAdapter} from './windows-adapter.js';

test('Windows unknown bootstrap then fresh work traverses reader, adapter, HTTP/SSE, store and lifecycle controller',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'turn-pipeline-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'synthetic.jsonl');let ordinal=0,clock=Date.parse('2026-01-01T00:00:00Z');
  const now=()=>new Date(clock).toISOString();
  const line=(type:string,payload:unknown)=>JSON.stringify({ordinal:ordinal++,timestamp:now(),type,payload})+'\n';
  await writeFile(path,line('session_meta',{id:'main',cwd:dir,cli_version:'0.166.0-alpha.5.1',source:'vscode',timestamp:now()})
    +line('event_msg',{type:'task_started',turn_id:'unknown-old'})+line('event_msg',{type:'task_complete',turn_id:'unknown-old'}));
  const initial={...snapshot(),source:'codex' as const};initial.agents[0].runtimeState='unknown';initial.agents[0].pendingRequestIds=['pending'];
  const base:OfficeAdapter={initialSnapshot:()=>initial,subscribe(){return()=>{};},stop(){}};
  const reader=new RolloutLifecycleReader({paths:[path],allowedCwds:[dir],sourceNamespace:'synthetic-pipeline',now});
  const adapter=await createWindowsTurnLifecycleAdapter({base,reader,pollMs:10,now});
  const server=await createOfficeServer({adapter});t.after(()=>server.close());
  const before=await(await fetch(server.url+'/api/office')).json();const store=createOfficeStore(before);store.selectAgent('main');
  const lifecycle=createTurnLifecycleController();
  // Attention remains in source truth; temporarily omit it from this animation
  // harness to exercise motion. Store/server preservation is asserted below.
  const visibleAgents=before.agents.map((a:typeof initial.agents[number])=>({...a,pendingRequestIds:[]}));
  const generation=lifecycle.baseline({agents:visibleAgents,latestTurns:before.latestTurns??[],connected:true,presentation:'live'});
  assert.equal(lifecycle.getState()[0].visible,null);
  assert.deepEqual(before.latestTurns,[],'unorderable historical outcome does not poison future starts');
  async function record(payload:Record<string,unknown>,status:string,effect:string) {
    await appendFile(path,line('event_msg',payload));
    const deadline=Date.now()+3000;let current;
    do{current=await(await fetch(server.url+'/api/office')).json();if(current.latestTurns?.[0]?.status===status&&current.lastSeq>store.getState().snapshot!.lastSeq)break;await new Promise(r=>setTimeout(r,15));}while(Date.now()<deadline);
    assert.equal(current.latestTurns?.[0]?.status,status);
    const cursor=store.getState().snapshot!;
    const response=await fetch(server.url+`/api/events?cursor=${cursor.bridgeEpoch}:${cursor.lastSeq}`,{signal:AbortSignal.timeout(3000)});
    const stream=response.body!.getReader();
    try{const text=new TextDecoder().decode((await stream.read()).value);assert.equal(text.includes('PRIVATE'),false);
      for(const row of text.split('\n').filter(row=>row.startsWith('data: '))){const event:unknown=JSON.parse(row.slice(6));assert.ok(isOfficeEvent(event));store.applyEvent(event);if(event.type==='agent.turn.observed')lifecycle.observe(event.data.observation,generation);}
    }finally{await stream.cancel();}
    const effects=lifecycle.drainEffects();assert.equal(effects.length,1);assert.equal(effects[0].type,effect);lifecycle.complete(effects[0].token);
  }
  clock+=10_000;await record({type:'task_started',turn_id:'a',started_at:clock/1000},'started','enter');
  await record({type:'task_complete',turn_id:'a',started_at:clock/1000,completed_at:clock/1000,last_agent_message:'PRIVATE'},'succeeded','exit');
  assert.equal(lifecycle.getState()[0].visible,false);
  clock+=10_000;await record({type:'task_started',turn_id:'b',started_at:clock/1000},'started','enter');
  await appendFile(path,line('event_msg',{type:'error',message:'PRIVATE',codex_error_info:'other'}));
  await record({type:'task_complete',turn_id:'b',started_at:clock/1000,completed_at:clock/1000},'failed','die');
  assert.equal(lifecycle.getState()[0].visible,false);
  clock+=10_000;await record({type:'task_started',turn_id:'c',started_at:clock/1000},'started','enter');
  await record({type:'turn_aborted',turn_id:'c',started_at:clock/1000,reason:'interrupted'},'interrupted','sleep');
  assert.equal(lifecycle.getState()[0].pose,'sleeping');
  clock+=10_000;await record({type:'task_started',turn_id:'d',started_at:clock/1000},'started','wake');
  assert.equal(store.getState().snapshot?.agents[0].runtimeState,'unknown');
  assert.deepEqual(store.getState().snapshot?.agents[0].pendingRequestIds,['pending']);assert.equal(store.getState().selectedAgentId,'main');
  const reconnect=await(await fetch(server.url+'/api/office')).json();
  lifecycle.baseline({agents:visibleAgents,latestTurns:reconnect.latestTurns,connected:true,presentation:'live'});
  assert.deepEqual(lifecycle.drainEffects(),[]);assert.equal(lifecycle.getState()[0].phase,'present');
});
