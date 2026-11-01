export type RuntimeState = 'working' | 'idle' | 'waiting-for-input' | 'waiting-for-approval' | 'error' | 'closed' | 'unknown';
export type ActivityKind = 'reading' | 'editing' | 'running-command' | 'researching' | 'communicating' | 'unknown';
export type EventSourceKind = 'codex' | 'office' | 'fixture';
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'unsupported';
export type PresentationState = 'ready' | 'arrivals' | 'standup' | 'live';

export interface Capability { supported: boolean; reason: string | null }
export interface OfficeConnection { status: ConnectionStatus; lastObservedAt: string | null; message: string | null }
export interface ActivityEntry {
  activityId: string;
  agentId: string;
  kind: ActivityKind;
  summary: string;
  occurredAt: string;
  sourceItemId: string | null;
  source: EventSourceKind;
}
export interface OfficeAgent {
  agentId: string;
  parentAgentId: string | null;
  projectId: string;
  displayName: string;
  role: string | null;
  task: string | null;
  runtimeState: RuntimeState;
  activityKind: ActivityKind;
  lastObservedAt: string | null;
  pendingRequestIds: string[];
  petAssetId: string | null;
  recentActivity: ActivityEntry[];
}
export interface OfficeProject { projectId: string; displayName: string; cwd: string | null }
export interface RequestOption { id: string; label: string; description?: string }
export interface OfficeRequest {
  requestId: string;
  agentId: string;
  kind: 'user-input' | 'approval' | 'unknown';
  prompt: string | null;
  options: RequestOption[];
  createdAt: string;
  responseCapability: Capability;
  revision: string | null;
}
export interface OfficeHandoff {
  handoffId: string;
  fromAgentId: string;
  toAgentId: string;
  summary: string;
  occurredAt: string;
  sourceItemId: string;
}
export interface PetAsset {
  assetId: string;
  name: string;
  imageUrl: string;
  origin: 'chatgpt' | 'codex';
  width: number;
  height: number;
  columns: number;
  rows: number;
  animations: Record<string, { row: number; frames: number; fps: number }>;
}
export interface OfficeSnapshot {
  protocolVersion: 1;
  bridgeEpoch: string;
  lastSeq: number;
  officeSessionId: string;
  source: 'codex' | 'fixture';
  connection: OfficeConnection;
  capabilities: { observeAgents: Capability; observeHandoffs: Capability; respondToRequests: Capability };
  presentation: { state: PresentationState; canSkip: boolean };
  agents: OfficeAgent[];
  projects: OfficeProject[];
  pendingRequests: OfficeRequest[];
  recentHandoffs: OfficeHandoff[];
  petAssets: PetAsset[];
  controlToken?: string;
}
export interface EventEnvelope<T extends string, D> {
  protocolVersion: 1;
  bridgeEpoch: string;
  seq: number;
  eventId: string;
  occurredAt: string;
  source: EventSourceKind;
  type: T;
  agentId: string | null;
  data: D;
}
export type OfficeEvent =
  | EventEnvelope<'project.upserted', { project: OfficeProject }>
  | EventEnvelope<'agent.upserted', { agent: OfficeAgent }>
  | EventEnvelope<'agent.activity', { activity: ActivityEntry }>
  | EventEnvelope<'agent.state.changed', { runtimeState: RuntimeState }>
  | EventEnvelope<'agent.work.completed', { sourceItemId: string }>
  | EventEnvelope<'agent.closed', { reason: string | null }>
  | EventEnvelope<'request.opened', { request: OfficeRequest }>
  | EventEnvelope<'request.resolved', { requestId: string; reason: string | null }>
  | EventEnvelope<'handoff.observed', { handoff: OfficeHandoff }>
  | EventEnvelope<'connection.changed', { connection: OfficeConnection }>
  | EventEnvelope<'presentation.changed', { officeSessionId: string; state: PresentationState; canSkip: boolean }>;

export const unsupported = (reason: string): Capability => ({ supported: false, reason });

export function emptySnapshot(epoch = 'unconnected'): OfficeSnapshot {
  return {
    protocolVersion: 1, bridgeEpoch: epoch, lastSeq: 0, officeSessionId: 'office-ready', source: 'codex',
    connection: { status: 'unsupported', lastObservedAt: null, message: 'Waiting for a Codex adapter connection.' },
    capabilities: {
      observeAgents: unsupported('No Codex adapter connected.'),
      observeHandoffs: unsupported('No handoff observer connected.'),
      respondToRequests: unsupported('In-office responses have not been verified for this runtime.'),
    },
    presentation: { state: 'ready', canSkip: false }, agents: [], projects: [], pendingRequests: [], recentHandoffs: [], petAssets: [],
  };
}
