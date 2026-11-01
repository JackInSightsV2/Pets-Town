import { emptySnapshot, type OfficeAgent, type OfficeEvent, type OfficeRequest, type OfficeSnapshot } from '../shared/contract';

export const time = '2026-11-01T13:00:00.000Z';
export function agent(agentId = 'main'): OfficeAgent {
  return { agentId, parentAgentId: null, projectId: 'project', displayName: agentId, role: null, task: null,
    runtimeState: 'working', activityKind: 'unknown', lastObservedAt: time, pendingRequestIds: [], petAssetId: null, recentActivity: [] };
}
export function snapshot(seq = 0, epoch = 'epoch-a'): OfficeSnapshot {
  return { ...emptySnapshot(epoch), lastSeq: seq, source: 'fixture', controlToken: 'test-control-token',
    connection: { status: 'connected', lastObservedAt: time, message: null }, agents: [agent()],
    projects: [{ projectId: 'project', displayName: 'Project', cwd: '/project' }] };
}
export function request(requestId = 'request-1', agentId = 'main'): OfficeRequest {
  return { requestId, agentId, kind: 'user-input', prompt: 'Choose a direction', options: [], createdAt: time,
    responseCapability: { supported: true, reason: null }, revision: 'v1' };
}
export function event<T extends OfficeEvent['type']>(seq: number, type: T,
  data: Extract<OfficeEvent, { type: T }>['data'], overrides: Partial<OfficeEvent> = {}): OfficeEvent {
  return { protocolVersion: 1, bridgeEpoch: 'epoch-a', seq, eventId: `event-${seq}`, occurredAt: time,
    source: type === 'presentation.changed' ? 'office' : 'fixture', type, agentId: 'main', data, ...overrides } as OfficeEvent;
}
