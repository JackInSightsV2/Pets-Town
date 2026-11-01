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

test('start, standup, skip and reset move presentation while preserving runtime state',async({page,request})=>{
  await page.goto('/');
  const pet=page.getByTestId('scene-agent-maple');
  await expect(pet).toHaveAttribute('data-location','entrance');
  const entrance=await point(pet);
  await page.getByTestId('start-day').click();
  await expect(pet).toHaveAttribute('data-location','standup');
  await expect(pet).toHaveAttribute('data-motion','arriving');
  expect(await point(pet)).not.toEqual(entrance);

  // Advance the explicit fixture's source presentation instead of waiting its 20s demo timer.
  const snapshot=await(await request.get('/api/office')).json() as OfficeSnapshot;
  await emit(request,'presentation.changed',null,{officeSessionId:snapshot.officeSessionId,state:'standup',canSkip:true},'office');
  await expect(page.getByTestId('presentation-state')).toHaveText('Standup');
  await expect(pet).toHaveAttribute('data-location','standup');
  await expect(pet).toHaveAttribute('data-motion','settled');
  const standup=await point(pet);
  await page.getByTestId('skip-standup').click();
  await expect(pet).toHaveAttribute('data-location','home');
  await expect(pet).toHaveAttribute('data-motion','settled');
  expect(await point(pet)).not.toEqual(standup);
  expect(await point(pet)).toEqual({left:await pet.getAttribute('data-home-left'),top:await pet.getAttribute('data-home-top')});
  await page.getByTestId('reset-scene').click();
  await expect(pet).toHaveAttribute('data-location','entrance');
  await expect(pet).toHaveAttribute('data-motion','settled');
  expect(await point(pet)).toEqual(entrance);
  await expect(pet).toHaveAttribute('data-runtime-state','working');
  const after=await(await request.get('/api/office')).json() as OfficeSnapshot;
  expect(after.agents.find(agent=>agent.agentId==='maple')?.runtimeState).toBe('working');
  // Skipping during arrival must cancel that motion as well.
  await page.getByTestId('start-day').click();
  await expect(pet).toHaveAttribute('data-motion','arriving');
  await page.getByTestId('skip-standup').click();
  await expect(pet).toHaveAttribute('data-location','home');
  await expect(pet).toHaveAttribute('data-motion','settled');
});

test('only observed idle moves a live pet to rest; disconnect and presentation retain truthful state',async({page,request})=>{
  await page.goto('/');
  await page.getByTestId('start-day').click();
  await page.getByTestId('skip-standup').click();
  const pet=page.getByTestId('scene-agent-maple');
  await expect(pet).toHaveAttribute('data-location','home');
  const home=await point(pet);
  await emit(request,'agent.state.changed','maple',{runtimeState:'idle'});
  await expect(pet).toHaveAttribute('data-runtime-state','idle');
  await expect(pet).toHaveAttribute('data-location','rest');
  const rest=await point(pet);expect(rest).not.toEqual(home);
  await emit(request,'connection.changed',null,{connection:{status:'disconnected',lastObservedAt:new Date().toISOString(),message:'Fixture source disconnected'}});
  await expect(page.getByTestId('connection-status')).toContainText(/disconnected|lost|offline/i);
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
