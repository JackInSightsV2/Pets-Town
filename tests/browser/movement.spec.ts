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
  await page.goto('/?view=2d');
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
  await page.goto('/?view=2d');
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

test('pet sizes, chair destinations and decorative nearby idle chatter follow observed state',async({page,request})=>{
  await emit(request,'request.resolved','willow',{requestId:'missing-details',reason:'Synthetic setup'});
  await emit(request,'agent.state.changed','willow',{runtimeState:'working'});
  await page.goto('/?view=2d');
  const parent=page.getByTestId('scene-agent-maple');
  const child=page.getByTestId('scene-agent-willow');
  await expect(parent.locator('.native-pet')).toHaveCSS('width','54px');
  await expect(child.locator('.native-pet')).toHaveCSS('width','36px');
  await expect(parent).toHaveAttribute('data-home-left','218px');
  await expect(parent).toHaveAttribute('data-home-top','119px');
  await expect(child).toHaveAttribute('data-home-left','286px');
  await expect(parent.locator('.native-pet')).toHaveAttribute('data-pet-load','loaded');
  await emit(request,'agent.state.changed','maple',{runtimeState:'idle'});
  await emit(request,'agent.state.changed','willow',{runtimeState:'idle'});
  await expect(parent).toHaveAttribute('data-location','rest');
  await expect(child).toHaveAttribute('data-location','rest');
  expect(await point(parent)).toEqual({left:'130px',top:'493px'});
  expect(await point(child)).toEqual({left:'262px',top:'493px'});
  await expect(page.getByTestId('ambient-chatter')).toBeVisible();
  await page.screenshot({path:'test-results/idle-seating-chatter.png',fullPage:true});
  await emit(request,'agent.state.changed','willow',{runtimeState:'working'});
  await expect(page.getByTestId('ambient-chatter')).toHaveCount(0);
  // Working children follow a resting parent under the shared family behavior.
  await expect(child).toHaveAttribute('data-location','family');
  await emit(request,'agent.state.changed','maple',{runtimeState:'working'});
  await expect(parent).toHaveAttribute('data-location','home');
  await expect(child).toHaveAttribute('data-location','home');
  await expect(child).toHaveCSS('left','286px');
  await expect(parent).toHaveCSS('left','218px');
  await expect(parent).toHaveCSS('top','119px');
  await page.screenshot({path:'test-results/desk-seating.png',fullPage:true});
});
