import { emptySnapshot, unsupported, type OfficeAgent, type OfficeEvent } from '../shared/contract.js';
import { builtInPets } from '../shared/pets.js';
import type { OfficeAdapter } from './adapter.js';

/** Explicit development fixture. No imagery or claims of a live Codex observation. */
export function createFixtureAdapter(stepMs = 2000): OfficeAdapter {
  const snapshot = emptySnapshot('fixture');
  const at = '2026-11-01T13:00:00.000Z';
  snapshot.source = 'fixture';
  snapshot.petAssets = structuredClone(builtInPets);
  snapshot.connection = { status: 'connected', lastObservedAt: at, message: 'FIXTURE — synthetic development data, not live Codex activity.' };
  snapshot.capabilities.observeAgents = { supported: true, reason: null };
  snapshot.projects = [{projectId:'fixture-project-a',displayName:'Fixture project A',cwd:null},{projectId:'fixture-project-b',displayName:'Fixture project B',cwd:null}];
  snapshot.agents = ['main','child','other'].map((name, i): OfficeAgent => ({
    agentId:`fixture-${name}`, parentAgentId:i===1?'fixture-main':null, projectId:i===2?'fixture-project-b':'fixture-project-a',
    displayName:`Fixture ${name}`,role:null,task:'Synthetic development task',runtimeState:i===1?'waiting-for-input':i===0?'working':'unknown',
    activityKind:i===0?'reading':'unknown',lastObservedAt:at,pendingRequestIds:i===1?['fixture-request']:[],petAssetId:builtInPets[i % builtInPets.length].assetId,
    recentActivity:i===0?[{activityId:'fixture-activity',agentId:'fixture-main',kind:'reading',summary:'Fixture: reading example files',occurredAt:at,sourceItemId:null,source:'fixture'}]:[],
  }));
  snapshot.pendingRequests = [{requestId:'fixture-request',agentId:'fixture-child',kind:'user-input',prompt:'Fixture question: which example should be shown?',options:[{id:'a',label:'Example A'}],createdAt:at,responseCapability:unsupported('Fixture requests cannot be answered.'),revision:'1'}];
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const cancel=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();};
  return {
    initialSnapshot: () => structuredClone(snapshot),
    subscribe(listener) {
      const payloads=[
        {type:'agent.activity',agentId:'fixture-main',data:{activity:{activityId:'fixture-activity-2',agentId:'fixture-main',kind:'editing',summary:'Fixture: editing an example file',occurredAt:'2026-11-01T13:00:02.000Z',sourceItemId:'fixture-item-2',source:'fixture'}}},
        {type:'handoff.observed',agentId:'fixture-main',data:{handoff:{handoffId:'fixture-handoff',fromAgentId:'fixture-main',toAgentId:'fixture-child',summary:'Fixture: synthetic handoff for visual development',occurredAt:'2026-11-01T13:00:04.000Z',sourceItemId:'fixture-handoff-item'}}},
        {type:'request.resolved',agentId:'fixture-child',data:{requestId:'fixture-request',reason:'Fixture: resolved in the simulated original client'}},
        {type:'agent.work.completed',agentId:'fixture-main',data:{sourceItemId:'fixture-turn-completed'}},
        {type:'agent.state.changed',agentId:'fixture-main',data:{runtimeState:'idle'}},
        {type:'connection.changed',agentId:null,data:{connection:{status:'disconnected',lastObservedAt:'2026-11-01T13:00:10.000Z',message:'FIXTURE — simulated disconnection'}}},
        {type:'connection.changed',agentId:null,data:{connection:{status:'connected',lastObservedAt:'2026-11-01T13:00:14.000Z',message:'FIXTURE — simulated reconnection'}}},
      ];
      payloads.forEach((payload,index)=>{
        const timer=setTimeout(()=>{timers.delete(timer);listener({protocolVersion:1,bridgeEpoch:'fixture',seq:index+1,eventId:`fixture-event-${index+1}`,occurredAt:new Date(Date.parse(at)+(index+1)*2000).toISOString(),source:'fixture',...payload} as OfficeEvent);},stepMs*(index+1));
        timers.add(timer);
      });
      return cancel;
    },
    stop:cancel,
  };
}
