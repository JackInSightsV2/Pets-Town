import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OfficeEvent } from '../../shared/contract.js';
import { createWindowsActivityAdapter } from './windows-adapter.js';

const line = (value: unknown) => JSON.stringify(value) + '\n';
const started = line({type:'event_msg',payload:{type:'task_started',turn_id:'synthetic-turn'}});
const record = (id: string) => ({ type:'event_msg', payload:{ type:'item_completed', thread_id:'synthetic-thread', turn_id:'synthetic-turn',
  item:{ type:'CommandExecution', id, status:'completed', command:'PRIVATE', output:'PRIVATE' } } });
test('real reader composition silently seeds history and publishes new command as recent history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  const nameIndex = join(dir, 'names.jsonl');
  await writeFile(nameIndex, line({ id:'synthetic-thread', thread_name:'Synthetic title', updated_at:'2026-11-01T12:00:00Z' }));
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + started + line(record('old')));
  const adapter = await createWindowsActivityAdapter({files:[path],cwds:[dir],pollMs:20,nameIndex,now:()=> '2026-11-01T12:00:00Z'}); t.after(()=>adapter.stop());
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,0);
  assert.equal((await adapter.initialSnapshot()).agents[0].displayName,'Synthetic title');
  const events: OfficeEvent[]=[]; adapter.subscribe(e=>events.push(e));
  const wrong = record('wrong-turn'); wrong.payload.turn_id = 'unrelated-turn';
  await appendFile(path,line(wrong) + line(record('new')));
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(await adapter.initialSnapshot()).agents[0].recentActivity.length) await new Promise(r=>setTimeout(r,25));
  const agent=(await adapter.initialSnapshot()).agents[0];
  assert.equal(agent.recentActivity.length,1); assert.equal(agent.recentActivity[0].summary,'Ran a command.');
  assert.equal(agent.activityKind,'unknown'); assert.equal(JSON.stringify(events).includes('PRIVATE'),false);
  assert.equal(events.some(e=>e.type==='agent.work.completed'),false);
});

test('a partial initial record remains history when completed on a later poll', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  const historical = line(record('partial'));
  const split = Math.floor(historical.length / 2);
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + started + historical.slice(0,split));
  const adapter = await createWindowsActivityAdapter({files:[path],cwds:[dir],pollMs:20,nameIndex:null}); t.after(()=>adapter.stop());
  await appendFile(path,historical.slice(split)); await new Promise(r=>setTimeout(r,150));
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,0);
  await appendFile(path,line(record('live')));
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(await adapter.initialSnapshot()).agents[0].recentActivity.length) await new Promise(r=>setTimeout(r,25));
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,1);
});

test('quarantined and out-of-scope records never publish staged activity', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + started);
  const adapter = await createWindowsActivityAdapter({files:[path],cwds:[dir],pollMs:20,nameIndex:null}); t.after(()=>adapter.stop());
  await appendFile(path, line(record('new')) + '{invalid json}\n');
  await new Promise(r=>setTimeout(r,150));
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,0);
  const outside = join(dir, 'outside.jsonl');
  await writeFile(outside,line({type:'session_meta',payload:{id:'synthetic-thread',cwd:join(dir,'different')}}));
  const other = await createWindowsActivityAdapter({files:[outside],cwds:[dir],pollMs:20,nameIndex:null}); t.after(()=>other.stop());
  await appendFile(outside,line(record('outside'))); await new Promise(r=>setTimeout(r,150));
  assert.equal((await other.initialSnapshot()).agents.length,0);
});

test('a failed metadata poll retains validated pending activity until a scoped reconnect', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + started);
  let failNextRead = false, failed = false;
  const adapter = await createWindowsActivityAdapter({ files:[path], cwds:[dir], pollMs:20, nameIndex:null,
    wrapReader: reader => ({ get connected() { return reader.connected; }, close:()=>reader.close(), async call(method, params) {
      if (method === 'thread/read' && failNextRead) { failNextRead = false; failed = true; throw new Error('synthetic metadata failure'); }
      return reader.call(method, params);
    } }) });
  t.after(()=>adapter.stop());
  failNextRead = true;
  await appendFile(path, line(record('pending')));
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(await adapter.initialSnapshot()).agents[0].recentActivity.length) await new Promise(r=>setTimeout(r,25));
  assert.equal(failed,true);
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,1);
  await new Promise(r=>setTimeout(r,100));
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,1);
});

test('activity capacity failure is reported even when the metadata connection event does not change', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + started);
  const adapter = await createWindowsActivityAdapter({files:[path],cwds:[dir],pollMs:20,nameIndex:null,now:()=> '2026-11-01T12:00:00Z'}); t.after(()=>adapter.stop());
  const events: OfficeEvent[]=[]; adapter.subscribe(event=>events.push(event));
  await appendFile(path, Array.from({length:10001}, (_, i)=>line(record(`item-${i}`))).join(''));
  const deadline=Date.now()+20000;
  while (Date.now()<deadline && !events.some(e=>e.type==='connection.changed' && e.data.connection.message?.includes('Command activity unavailable'))) await new Promise(r=>setTimeout(r,25));
  assert.ok(events.some(e=>e.type==='connection.changed' && e.data.connection.message?.includes('Command activity unavailable')));
  assert.ok((await adapter.initialSnapshot()).agents[0].recentActivity.length <= 50);
});
