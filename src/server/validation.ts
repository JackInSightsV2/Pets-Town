import type { OfficeEvent } from '../shared/contract.js';

type RecordValue = Record<string, unknown>;
const object=(value:unknown):value is RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string';
const nullableText=(value:unknown)=>value===null||text(value);
const strings=(value:unknown)=>Array.isArray(value)&&value.every(text);
const oneOf=(value:unknown,choices:string[])=>text(value)&&choices.includes(value);
const timestamp=(value:unknown)=>text(value)&&Number.isFinite(Date.parse(value));
const source=(value:unknown)=>oneOf(value,['codex','office','fixture']);
const runtime=(value:unknown)=>oneOf(value,['working','idle','waiting-for-input','waiting-for-approval','error','closed','unknown']);
const activityKind=(value:unknown)=>oneOf(value,['reading','editing','running-command','researching','communicating','unknown']);
const capability=(value:unknown)=>object(value)&&typeof value.supported==='boolean'&&nullableText(value.reason);
const capabilities=(value:unknown)=>object(value)&&['observeAgents','observeHandoffs','respondToRequests'].every(key=>capability(value[key]));
const activity=(value:unknown)=>object(value)&&text(value.activityId)&&text(value.agentId)&&activityKind(value.kind)&&text(value.summary)&&timestamp(value.occurredAt)&&nullableText(value.sourceItemId)&&source(value.source);
const agent=(value:unknown)=>object(value)&&text(value.agentId)&&nullableText(value.parentAgentId)&&text(value.projectId)&&text(value.displayName)&&nullableText(value.role)&&nullableText(value.task)&&runtime(value.runtimeState)&&activityKind(value.activityKind)&&(value.lastObservedAt===null||timestamp(value.lastObservedAt))&&strings(value.pendingRequestIds)&&nullableText(value.petAssetId)&&Array.isArray(value.recentActivity)&&value.recentActivity.every(activity);
const request=(value:unknown)=>object(value)&&text(value.requestId)&&text(value.agentId)&&oneOf(value.kind,['user-input','approval','unknown'])&&nullableText(value.prompt)&&Array.isArray(value.options)&&value.options.every(option=>object(option)&&text(option.id)&&text(option.label)&&(option.description===undefined||text(option.description)))&&timestamp(value.createdAt)&&capability(value.responseCapability)&&nullableText(value.revision);
const connection=(value:unknown)=>object(value)&&oneOf(value.status,['connected','disconnected','reconnecting','unsupported'])&&(value.lastObservedAt===null||timestamp(value.lastObservedAt))&&nullableText(value.message);

/** Validate the whole consumed payload before it can enter snapshot or browser state. */
export function validEvent(event: unknown): event is OfficeEvent {
  if(!object(event)||event.protocolVersion!==1||!text(event.eventId)||!event.eventId||!timestamp(event.occurredAt)||!source(event.source)||!nullableText(event.agentId)||!object(event.data))return false;
  const data=event.data;
  switch(event.type) {
    case 'project.upserted': {const p=data.project;return event.agentId===null&&object(p)&&text(p.projectId)&&text(p.displayName)&&nullableText(p.cwd);}
    case 'agent.upserted': return agent(data.agent);
    case 'agent.activity': return activity(data.activity);
    case 'agent.state.changed': return text(event.agentId)&&runtime(data.runtimeState);
    case 'agent.work.completed': return text(event.agentId)&&text(data.sourceItemId);
    case 'agent.closed': return text(event.agentId)&&nullableText(data.reason);
    case 'request.opened': return request(data.request);
    case 'request.resolved': return text(data.requestId)&&nullableText(data.reason);
    case 'handoff.observed': {const h=data.handoff;return object(h)&&text(h.handoffId)&&text(h.fromAgentId)&&text(h.toAgentId)&&text(h.summary)&&timestamp(h.occurredAt)&&text(h.sourceItemId);}
    case 'capabilities.changed': return event.agentId===null&&capabilities(data.capabilities);
    case 'connection.changed': return connection(data.connection);
    case 'presentation.changed': return event.source==='office'&&text(data.officeSessionId)&&oneOf(data.state,['ready','arrivals','standup','live'])&&typeof data.canSkip==='boolean';
    default:return false;
  }
}
