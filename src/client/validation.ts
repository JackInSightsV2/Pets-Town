import type { OfficeEvent, OfficeSnapshot } from '../shared/contract';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string';
const id = (v: unknown): v is string => string(v) && v.length > 0;
const nullable = (check: (v: unknown) => boolean) => (v: unknown) => v === null || check(v);
const textOrNull = nullable(string);
const bool = (v: unknown) => typeof v === 'boolean';
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const timestamp = (v: unknown) => string(v) && Number.isFinite(Date.parse(v));
const array = (v: unknown, check: (v: unknown) => boolean) => Array.isArray(v) && v.length <= 20_000 && v.every(check);
const oneOf = (...values: string[]) => (v: unknown) => string(v) && values.includes(v);
const runtime = oneOf('working', 'idle', 'waiting-for-input', 'waiting-for-approval', 'error', 'closed', 'unknown');
const activityKind = oneOf('reading', 'editing', 'running-command', 'researching', 'communicating', 'unknown');
const source = oneOf('codex', 'office', 'fixture');
const presentationState = oneOf('ready', 'arrivals', 'standup', 'live');
const capability = (v: unknown) => record(v) && bool(v.supported) && textOrNull(v.reason);
const connection = (v: unknown) => record(v) && oneOf('connected', 'reconnecting', 'disconnected', 'unsupported')(v.status)
  && nullable(timestamp)(v.lastObservedAt) && textOrNull(v.message);
const activity = (v: unknown) => record(v) && id(v.activityId) && id(v.agentId) && activityKind(v.kind)
  && string(v.summary) && timestamp(v.occurredAt) && textOrNull(v.sourceItemId) && source(v.source);
const agent = (v: unknown) => record(v) && id(v.agentId) && textOrNull(v.parentAgentId) && id(v.projectId)
  && string(v.displayName) && textOrNull(v.role) && textOrNull(v.task) && runtime(v.runtimeState)
  && activityKind(v.activityKind) && nullable(timestamp)(v.lastObservedAt) && array(v.pendingRequestIds, id)
  && textOrNull(v.petAssetId) && array(v.recentActivity, a => activity(a) && (a as RecordValue).agentId === v.agentId);
const project = (v: unknown) => record(v) && id(v.projectId) && string(v.displayName) && textOrNull(v.cwd);
const option = (v: unknown) => record(v) && id(v.id) && string(v.label) && (v.description === undefined || string(v.description));
const request = (v: unknown) => record(v) && id(v.requestId) && id(v.agentId)
  && oneOf('user-input', 'approval', 'unknown')(v.kind) && textOrNull(v.prompt) && array(v.options, option)
  && timestamp(v.createdAt) && capability(v.responseCapability) && textOrNull(v.revision);
const handoff = (v: unknown) => record(v) && id(v.handoffId) && id(v.fromAgentId) && id(v.toAgentId)
  && string(v.summary) && timestamp(v.occurredAt) && id(v.sourceItemId);
const pet = (v: unknown) => record(v) && id(v.assetId) && string(v.name) && string(v.imageUrl)
  && oneOf('chatgpt', 'codex')(v.origin) && ['width', 'height', 'columns', 'rows'].every(k => integer(v[k]) && (v[k] as number) > 0)
  && record(v.animations) && Object.values(v.animations).every(a => record(a) && integer(a.row)
    && a.row < (v.rows as number) && integer(a.frames) && a.frames > 0 && a.frames <= (v.columns as number)
    && typeof a.fps === 'number' && Number.isFinite(a.fps) && a.fps > 0);
const unique = (items: unknown[], key: string) => new Set(items.map(v => (v as RecordValue)[key])).size === items.length;

export function isOfficeSnapshot(v: unknown): v is OfficeSnapshot {
  if (!record(v) || v.protocolVersion !== 1 || !id(v.bridgeEpoch) || !integer(v.lastSeq)
    || !id(v.officeSessionId) || !oneOf('codex', 'fixture')(v.source) || !connection(v.connection)
    || !record(v.capabilities) || !['observeAgents', 'observeHandoffs', 'respondToRequests'].every(k => capability((v.capabilities as RecordValue)[k]))
    || !record(v.presentation) || !presentationState(v.presentation.state) || !bool(v.presentation.canSkip)
    || !array(v.agents, agent) || !array(v.projects, project) || !array(v.pendingRequests, request)
    || !array(v.recentHandoffs, handoff) || !array(v.petAssets, pet)
    || (v.controlToken !== undefined && !id(v.controlToken))) return false;
  return [['agents', 'agentId'], ['projects', 'projectId'], ['pendingRequests', 'requestId'],
    ['recentHandoffs', 'handoffId'], ['petAssets', 'assetId']].every(([field, key]) => unique(v[field] as unknown[], key));
}

export function isOfficeEvent(v: unknown): v is OfficeEvent {
  if (!record(v) || v.protocolVersion !== 1 || !id(v.bridgeEpoch) || !integer(v.seq) || v.seq === 0
    || !id(v.eventId) || !timestamp(v.occurredAt) || !source(v.source) || !textOrNull(v.agentId) || !record(v.data)) return false;
  const d = v.data;
  switch (v.type) {
    case 'project.upserted': return v.agentId === null && project(d.project);
    case 'agent.upserted': return agent(d.agent) && (d.agent as RecordValue).agentId === v.agentId;
    case 'agent.activity': return activity(d.activity) && (d.activity as RecordValue).agentId === v.agentId;
    case 'agent.state.changed': return id(v.agentId) && runtime(d.runtimeState);
    case 'agent.work.completed': return id(v.agentId) && id(d.sourceItemId);
    case 'agent.closed': return id(v.agentId) && textOrNull(d.reason);
    case 'request.opened': return request(d.request) && (d.request as RecordValue).agentId === v.agentId;
    case 'request.resolved': return id(d.requestId) && textOrNull(d.reason);
    case 'handoff.observed': return handoff(d.handoff);
    case 'connection.changed': return connection(d.connection);
    case 'presentation.changed': return v.source === 'office' && id(d.officeSessionId) && presentationState(d.state) && bool(d.canSkip);
    default: return false;
  }
}
