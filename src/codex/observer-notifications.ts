/** Whitelist metadata-only native notifications. Never retain item text or request bodies. */
export type ObserverNotification =
  | { method: 'thread/status/changed'; params: { threadId: string; status: { type: 'active'; activeFlags: ('waitingOnApproval' | 'waitingOnUserInput')[] } | { type: 'idle' | 'notLoaded' | 'systemError' } } }
  | { method: 'item/completed'; params: { threadId: string; turnId: string; item: { type: 'subAgentActivity'; id: string; kind: 'interacted'; agentThreadId: string } } };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Server requests have IDs and are deliberately excluded; observing does not grant response ownership. */
export function selectObserverNotification(value: unknown): ObserverNotification | null {
  if (!object(value) || 'id' in value || !object(value.params)) return null;
  const p = value.params;
  if (!text(p.threadId)) return null;
  if (value.method === 'thread/status/changed' && object(p.status)) {
    const type = p.status.type;
    if (type === 'active') {
      if (!Array.isArray(p.status.activeFlags) || !p.status.activeFlags.every(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')) return null;
      return { method: value.method, params: { threadId: p.threadId, status: { type, activeFlags: [...p.status.activeFlags] } } };
    }
    if (type === 'idle' || type === 'notLoaded' || type === 'systemError') return { method: value.method, params: { threadId: p.threadId, status: { type } } };
    return null;
  }
  if (value.method !== 'item/completed' || !text(p.turnId) || !object(p.item)) return null;
  const item = p.item;
  if (item.type !== 'subAgentActivity' || item.kind !== 'interacted' || !text(item.id)
    || !text(item.agentThreadId) || item.agentThreadId === p.threadId
    || (item.senderThreadId !== undefined && item.senderThreadId !== p.threadId)) return null;
  return { method: value.method, params: { threadId: p.threadId, turnId: p.turnId,
    item: { type: 'subAgentActivity', id: item.id, kind: 'interacted', agentThreadId: item.agentThreadId } } };
}
