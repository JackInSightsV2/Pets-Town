import type { OfficeEvent, OfficeSnapshot } from '../shared/contract.js';
import { isTurnLifecycleObservation } from '../shared/turn-lifecycle.js';
import { createHash } from 'node:crypto';

/** Return only explicitly projected events; otherwise require a fresh scoped snapshot. */
export function projectEvents(events: OfficeEvent[] | null, snapshot: OfficeSnapshot, cursor: { bridgeEpoch: string; lastSeq: number; source: OfficeSnapshot['source'] }): OfficeEvent[] | null {
  if (!events || cursor.bridgeEpoch !== snapshot.bridgeEpoch || cursor.source !== snapshot.source || snapshot.connection.status !== 'connected') return null;
  if (events.length !== snapshot.lastSeq - cursor.lastSeq) return null;
  const ids = new Set(snapshot.agents.map(agent => agent.agentId));
  const projected: OfficeEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (event.bridgeEpoch !== cursor.bridgeEpoch || event.seq !== cursor.lastSeq + index + 1) return null;
    const envelope = { protocolVersion: 1 as const, bridgeEpoch: event.bridgeEpoch, seq: event.seq,
      eventId: createHash('sha256').update(event.eventId).digest('hex'), occurredAt: event.occurredAt, source: event.source, agentId: event.agentId };
    if (event.type === 'connection.changed') {
      if (event.data.connection.status !== 'connected') return null;
      const connection = event.data.connection;
      projected.push({ ...envelope, agentId: null, type: event.type, data: { connection: { status: connection.status,
        lastObservedAt: connection.lastObservedAt, message: connection.message?.slice(0, 2000) ?? null } } });
      continue;
    }
    if (event.type === 'project.upserted') {
      const project = snapshot.projects.find(row => row.projectId === event.data.project.projectId);
      if (!project) return null;
      projected.push({ ...envelope, agentId: null, type: event.type, data: { project } });
      continue;
    }
    if (event.type === 'capabilities.changed') {
      projected.push({ ...envelope, agentId: null, type: event.type, data: { capabilities: snapshot.capabilities } });
      continue;
    }
    if (event.type === 'handoff.observed') {
      const handoff = snapshot.recentHandoffs.find(row => row.handoffId === event.data.handoff.handoffId);
      if (!handoff || !ids.has(handoff.fromAgentId) || !ids.has(handoff.toAgentId)) return null;
      projected.push({ ...envelope, agentId: null, type: event.type, data: { handoff } });
      continue;
    }
    if (!event.agentId || !ids.has(event.agentId)) return null;
    if (event.type === 'agent.turn.observed' && isTurnLifecycleObservation(event.data.observation)
      && event.data.observation.agentId === event.agentId && event.data.observation.source === snapshot.source) {
      const { agentId, turnId, sourceEventId, status, source, delivery, occurredAt, startedAt } = event.data.observation;
      projected.push({ ...envelope, type: event.type, data: { observation: { agentId, turnId, sourceEventId, status, source, delivery, occurredAt, startedAt } } });
    } else if (event.type === 'agent.state.changed') {
      projected.push({ ...envelope, type: event.type, data: { runtimeState: event.data.runtimeState } });
    } else if (event.type === 'agent.upserted') {
      const agent = snapshot.agents.find(row => row.agentId === event.agentId);
      if (!agent || event.data.agent.agentId !== event.agentId || event.data.agent.projectId !== agent.projectId) return null;
      projected.push({ ...envelope, type: event.type, data: { agent } });
    } else if (event.type === 'agent.activity') {
      const activity = event.data.activity;
      if (activity.agentId !== event.agentId) return null;
      projected.push({ ...envelope, type: event.type, data: { activity: { activityId: activity.activityId,
        agentId: activity.agentId, kind: activity.kind, summary: activity.summary.slice(0, 600),
        occurredAt: activity.occurredAt, sourceItemId: null, source: activity.source } } });
    } else if (event.type === 'request.opened') {
      const request = snapshot.pendingRequests.find(row => row.requestId === event.data.request.requestId && row.agentId === event.agentId);
      if (!request) return null;
      projected.push({ ...envelope, type: event.type, data: { request } });
    } else if (event.type === 'request.resolved') {
      projected.push({ ...envelope, type: event.type, data: { requestId: event.data.requestId, reason: null } });
    } else if (event.type === 'agent.closed') {
      projected.push({ ...envelope, type: event.type, data: { reason: null } });
    } else if (event.type === 'agent.work.completed') {
      projected.push({ ...envelope, type: event.type, data: { sourceItemId: createHash('sha256').update(event.data.sourceItemId).digest('hex') } });
    } else return null;
  }
  return projected;
}
