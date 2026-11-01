import { test, expect, type APIRequestContext } from '@playwright/test';
import type { OfficeAgent, OfficeSnapshot } from '../../src/shared/contract.js';

async function emit(request: APIRequestContext, type: string, agentId: string | null, data: unknown) {
  const response=await request.post('http://127.0.0.1:5418/events',{data:{type,agentId,data}});
  expect(response.ok()).toBeTruthy();
}
function agent(id:string,projectId:string,parentAgentId:string|null=null):OfficeAgent {
  return {agentId:id,parentAgentId,projectId,displayName:id,role:null,task:'Explicit layout fixture',runtimeState:'working',activityKind:'unknown',lastObservedAt:new Date().toISOString(),pendingRequestIds:[],petAssetId:'dewey',recentActivity:[]};
}
async function prepare(request:APIRequestContext,prefix:string) {
  const snapshot=await (await request.get('/api/office')).json() as OfficeSnapshot;
  await request.post('/api/presentation/reset',{headers:{'X-Office-Token':snapshot.controlToken!}});
  const agents:OfficeAgent[]=[];
  for(let i=0;i<6;i++) {
    const projectId=`${prefix}-project-${i}`;
    await emit(request,'project.upserted',null,{project:{projectId,displayName:`Layout project ${i}`,cwd:null}});
    agents.push(agent(`${prefix}-parent-${i}`,projectId));
  }
  for(let i=0;i<10;i++)agents.push(agent(`${prefix}-child-${i}`,`${prefix}-project-0`,`${prefix}-parent-0`));
  for(const value of agents)await emit(request,'agent.upserted',value.agentId,{agent:value});
  return agents;
}
async function closeAgents(request:APIRequestContext,agents:OfficeAgent[]) {
  for(const value of agents)await emit(request,'agent.closed',value.agentId,{reason:'Layout fixture cleanup'});
}

test('six projects and ten children expand without losing hidden request inspection or stable parent position',async({page,request})=>{
  const prefix='stress-groups';const agents=await prepare(request,prefix);
  const parentId=`${prefix}-parent-0`, childId=`${prefix}-child-9`, requestId=`${prefix}-request`;
  try {
    await page.goto('/');
    await page.getByRole('checkbox',{name:'Show subagents'}).check();
    await expect(page.locator('.office-project-area, .office-project-label')).toHaveCount(0);
    const homes=await Promise.all(Array.from({length:6},(_,i)=>page.getByTestId(`scene-agent-${prefix}-parent-${i}`).getAttribute('style')));
    expect(new Set(homes).size).toBe(6);
    const sceneParent=page.getByTestId(`scene-agent-${parentId}`);
    const home=[await sceneParent.getAttribute('data-home-left'),await sceneParent.getAttribute('data-home-top')];
    await expect(page.getByTestId(`group-toggle-${parentId}`)).toContainText('Show all 10 subagents');
    await expect(page.locator(`[data-testid^="agent-button-${prefix}-child-"]`)).toHaveCount(3);
    await page.getByTestId(`group-toggle-${parentId}`).click();
    await expect(page.locator(`[data-testid^="agent-button-${prefix}-child-"]`)).toHaveCount(10);
    await expect(page.locator(`[data-testid^="scene-agent-${prefix}-child-"]`)).toHaveCount(10);
    await expect(page.getByTestId(`group-toggle-${parentId}`)).toContainText('Show fewer subagents');
    await page.screenshot({path:'docs/evidence/track-c-layout-expanded.png',fullPage:true});
    await page.getByTestId(`scene-agent-${prefix}-parent-5`).scrollIntoViewIfNeeded();
    await page.screenshot({path:'docs/evidence/track-c-layout-sixth-project.png',fullPage:true});
    await emit(request,'request.opened',childId,{request:{requestId,agentId:childId,kind:'user-input',prompt:'Fixture: inspect this hidden child request',options:[],createdAt:new Date().toISOString(),responseCapability:{supported:false,reason:'Explicit browser fixture'},revision:'1'}});
    await page.getByRole('checkbox',{name:'Show subagents'}).uncheck();
    await expect(page.locator(`[data-testid^="scene-agent-${prefix}-child-"]`)).toHaveCount(0);
    await expect(sceneParent).toHaveAttribute('data-home-left',home[0]!);
    await expect(sceneParent).toHaveAttribute('data-home-top',home[1]!);
    await page.getByTestId(`inspect-hidden-${childId}`).click();
    await expect(page.getByTestId('selected-agent-name')).toHaveText(childId);
    await expect(page.getByTestId(`request-${requestId}`)).toBeVisible();
    await expect(page.getByRole('checkbox',{name:'Show subagents'})).not.toBeChecked();
    await expect(page.getByTestId(`scene-agent-${childId}`)).toHaveCount(0);
  } finally {await emit(request,'request.resolved',childId,{requestId,reason:'Fixture cleanup'});await closeAgents(request,agents);}
});

test('joins, departures and missing parents retain inspectable agents and stable existing positions',async({page,request})=>{
  const prefix='stress-lifecycle';const agents=await prepare(request,prefix);
  const parentId=`${prefix}-parent-1`;
  const orphan=agent(`${prefix}-orphan`,`${prefix}-project-1`,`${prefix}-absent-parent`);
  const late=agent(`${prefix}-late`,`${prefix}-project-5`);
  agents.push(orphan,late);
  try {
    await page.goto('/');
    await page.getByRole('checkbox',{name:'Show subagents'}).check();
    const parent=page.getByTestId(`scene-agent-${parentId}`);
    await expect(parent).toBeVisible();
    const home=[await parent.getAttribute('data-home-left'),await parent.getAttribute('data-home-top')];
    await emit(request,'agent.upserted',orphan.agentId,{agent:orphan});
    await emit(request,'agent.upserted',late.agentId,{agent:late});
    await expect(page.getByTestId(`agent-button-${orphan.agentId}`)).toBeVisible();
    await expect(page.getByTestId('unobserved-parent').first()).toBeVisible();
    await page.getByTestId(`agent-button-${orphan.agentId}`).click();
    await expect(page.getByTestId('selected-agent-name')).toHaveText(orphan.agentId);
    await expect(page.getByTestId(`scene-agent-${late.agentId}`)).toBeVisible();
    await expect(parent).toHaveAttribute('data-home-left',home[0]!);
    await expect(parent).toHaveAttribute('data-home-top',home[1]!);
    await emit(request,'agent.closed',late.agentId,{reason:'Fixture agent departure'});
    await expect(page.getByTestId(`scene-agent-${late.agentId}`)).toHaveCount(0);
    await expect(parent).toHaveAttribute('data-home-left',home[0]!);
    await expect(parent).toHaveAttribute('data-home-top',home[1]!);
    await emit(request,'agent.closed',`${prefix}-parent-0`,{reason:'Fixture parent departure'});
    await expect(page.getByTestId(`scene-agent-${prefix}-parent-0`)).toHaveCount(0);
    await expect(page.getByTestId(`agent-button-${prefix}-child-0`)).toBeVisible();
    await page.getByTestId(`agent-button-${prefix}-child-0`).click();
    await expect(page.getByTestId('selected-agent-name')).toHaveText(`${prefix}-child-0`);
  } finally {await closeAgents(request,agents);}
});
