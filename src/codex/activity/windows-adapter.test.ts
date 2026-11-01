import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OfficeEvent } from '../../shared/contract.js';
import { createWindowsActivityAdapter } from './windows-adapter.js';

const line = (value: unknown) => JSON.stringify(value) + '\n';
const record = (id: string) => ({ type:'event_msg', payload:{ type:'item_completed', thread_id:'synthetic-thread', turn_id:'synthetic-turn',
  item:{ type:'CommandExecution', id, status:'completed', command:'PRIVATE', output:'PRIVATE' } } });
test('real reader composition silently seeds history and publishes new command as recent history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  const nameIndex = join(dir, 'names.jsonl');
  await writeFile(nameIndex, line({ id:'synthetic-thread', thread_name:'Synthetic title', updated_at:'2026-11-01T12:00:00Z' }));
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}) + line(record('old')));
  const adapter = await createWindowsActivityAdapter({files:[path],cwds:[dir],pollMs:20,nameIndex}); t.after(()=>adapter.stop());
  assert.equal((await adapter.initialSnapshot()).agents[0].recentActivity.length,0);
  assert.equal((await adapter.initialSnapshot()).agents[0].displayName,'Synthetic title');
  const events: OfficeEvent[]=[]; adapter.subscribe(e=>events.push(e));
  await appendFile(path,line(record('new')));
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(await adapter.initialSnapshot()).agents[0].recentActivity.length) await new Promise(r=>setTimeout(r,25));
  const agent=(await adapter.initialSnapshot()).agents[0];
  assert.equal(agent.recentActivity.length,1); assert.equal(agent.recentActivity[0].summary,'Ran a command.');
  assert.equal(agent.activityKind,'unknown'); assert.equal(JSON.stringify(events).includes('PRIVATE'),false);
  assert.equal(events.some(e=>e.type==='agent.work.completed'),false);
});

test('quarantined and out-of-scope records never publish staged activity', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-test-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'synthetic.jsonl');
  await writeFile(path, line({type:'session_meta',payload:{id:'synthetic-thread',cwd:dir}}));
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
