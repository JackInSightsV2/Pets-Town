import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';
import type { OfficeSnapshot } from '../../src/shared/contract.js';

async function emit(request:APIRequestContext,type:string,agentId:string|null,data:unknown,source='fixture') {
  const response=await request.post('http://127.0.0.1:5418/events',{data:{type,agentId,data,source}});
  expect(response.ok()).toBeTruthy();
}
async function point(pet:Locator) {
  return pet.evaluate(element=>({left:(element as HTMLElement).style.left,top:(element as HTMLElement).style.top}));
}
test.beforeEach(async({request})=>{
  const snapshot=await(await request.get('/api/office')).json() as OfficeSnapshot;
  await emit(request,'agent.state.changed','maple',{runtimeState:'working'});
  await emit(request,'connection.changed',null,{connection:{status:'connected',lastObservedAt:new Date().toISOString(),message:'Explicit browser movement fixture'}});
  await request.post('/api/presentation/reset',{headers:{'X-Office-Token':snapshot.controlToken!}});
});

test('fullscreen startup uses live placement without changing runtime and ignores presentation-only resets',async({page,request})=>{
  await page.goto('/');
  const pet=page.getByTestId('scene-agent-maple');
  await expect(pet).toHaveAttribute('data-location','home');
  await expect.poll(async () => ((await(await request.get('/api/office')).json()) as OfficeSnapshot).presentation.state).toBe('live');
  const home=await point(pet);
  await expect(page.getByTestId('start-day')).toHaveCount(0);
  const snapshot=await(await request.get('/api/office')).json() as OfficeSnapshot;
  for (const action of ['reset','start','skip']) {
    await request.post(`/api/presentation/${action}`,{headers:{'X-Office-Token':snapshot.controlToken!}});
    await expect(pet).toHaveAttribute('data-location','home');
    await expect(pet).toHaveAttribute('data-runtime-state','working');
    expect(await point(pet)).toEqual(home);
  }
  const after=await(await request.get('/api/office')).json() as OfficeSnapshot;
  expect(after.agents.find(agent=>agent.agentId==='maple')?.runtimeState).toBe('working');
});

test('only observed idle moves a live pet to rest; disconnect and presentation retain truthful state',async({page,request})=>{
  await page.goto('/');
  const pet=page.getByTestId('scene-agent-maple');
  await expect(pet).toHaveAttribute('data-location','home');
  const home=await point(pet);
  await emit(request,'agent.state.changed','maple',{runtimeState:'idle'});
  await expect(pet).toHaveAttribute('data-runtime-state','idle');
  await expect(pet).toHaveAttribute('data-location','rest');
  const rest=await point(pet);expect(rest).not.toEqual(home);
  await emit(request,'connection.changed',null,{connection:{status:'disconnected',lastObservedAt:new Date().toISOString(),message:'Fixture source disconnected'}});
  await pet.click();
  await expect(page.getByTestId('stale-agent-data')).toHaveText('Last observed');
  await expect(pet).toHaveAttribute('data-runtime-state','idle');
  expect(await point(pet)).toEqual(rest);
  await emit(request,'connection.changed',null,{connection:{status:'connected',lastObservedAt:new Date().toISOString(),message:'Explicit browser movement fixture'}});
  await emit(request,'agent.state.changed','maple',{runtimeState:'working'});
  await expect(pet).toHaveAttribute('data-location','home');
  await expect(pet).toHaveAttribute('data-runtime-state','working');
  expect(await point(pet)).toEqual(home);
  await emit(request,'agent.state.changed','maple',{runtimeState:'waiting-for-input'});
  await expect(pet).toHaveAttribute('data-runtime-state','waiting-for-input');
  await expect(pet).toHaveAttribute('data-location','home');
  expect(await point(pet)).toEqual(home);
});
