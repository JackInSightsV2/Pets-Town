/**
 * Manual integration proof only; lane B owns the production adapter.
 * Wire allowlist: initialize, initialized, thread/loaded/list, thread/read.
 * No start/resume/turn/approval/interrupt/config or other control methods exist here.
 * Thread reads always set includeTurns:false; conversation previews are discarded.
 */
import WebSocket from 'ws';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OfficeAdapter } from '../../src/server/adapter.js';
import { emptySnapshot, unsupported, type OfficeAgent, type OfficeConnection, type OfficeEvent, type OfficeSnapshot, type RuntimeState } from '../../src/shared/contract.js';
import { builtInPets } from '../../src/shared/pets.js';

type RpcMethod = 'initialize' | 'thread/loaded/list' | 'thread/read';
const READ_ONLY_METHODS = new Set<RpcMethod>(['initialize', 'thread/loaded/list', 'thread/read']);
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;
const POLL_MS = 2000;

class MetadataRpc {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private socket: WebSocket) {
    socket.on('message', bytes => {
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      // Ignore notifications and unsolicited server requests without retaining their contents.
      if (!object(message) || typeof message.id !== 'number' || !('result' in message || 'error' in message)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if ('error' in message) {
        const code = object(message.error) && typeof message.error.code === 'number' ? message.error.code : 'unknown';
        pending.reject(new Error(`Codex metadata request rejected (${code}).`));
      } else pending.resolve(message.result);
    });
    const disconnected = () => this.rejectPending(new Error('Codex metadata socket disconnected.'));
    socket.on('error', disconnected);
    socket.on('close', disconnected);
  }
  static async connect(socketPath: string): Promise<MetadataRpc> {
    // ws+unix performs the HTTP Upgrade required by the daemon control socket.
    const socket = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: 5000, maxPayload: 20 * 1024 * 1024 });
    const rpc = new MetadataRpc(socket);
    try {
      await new Promise<void>((done, reject) => {
        socket.once('open', done);
        socket.once('error', () => reject(new Error('Could not connect to the existing Codex metadata socket.')));
      });
      await rpc.call('initialize', { clientInfo: { name: 'petstown-manual-metadata-observer', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      socket.send(JSON.stringify({ method: 'initialized' }));
      return rpc;
    } catch (error) { rpc.close(); throw error; }
  }
  get connected() { return this.socket.readyState === WebSocket.OPEN; }
  call(method: RpcMethod, params: JsonObject): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) return Promise.reject(new Error('Method outside the read-only allowlist.'));
    if (!this.connected) return Promise.reject(new Error('Codex metadata socket is not connected.'));
    return new Promise((done, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} metadata request timed out.`)); }, 5000);
      this.pending.set(id, { resolve: done, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Could not send Codex metadata request.')); }
      });
    });
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close() { this.rejectPending(new Error('Metadata observer stopped.')); this.socket.terminate(); }
}

function runtime(metadata: JsonObject): RuntimeState {
  const status = metadata.status;
  if (!object(status)) return 'unknown';
  if (status.type === 'systemError') return 'error';
  if (status.type === 'idle') return 'idle';
  if (status.type !== 'active') return 'unknown';
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  if (flags.includes('waitingOnApproval')) return 'waiting-for-approval';
  if (flags.includes('waitingOnUserInput')) return 'waiting-for-input';
  return 'working';
}

export async function createAdapter(): Promise<OfficeAdapter> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let paths: unknown = [resolve(root, '../PetsTown'), root];
  if (process.env.PETSTOWN_METADATA_CWDS) paths = JSON.parse(process.env.PETSTOWN_METADATA_CWDS);
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every(path => typeof path === 'string' && isAbsolute(path))) {
    throw new Error('PETSTOWN_METADATA_CWDS must be a JSON array of absolute allowed working directories.');
  }
  const allowedCwds = new Set((paths as string[]).map(path => resolve(path)));
  const socketPath = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
  if (!isAbsolute(socketPath) || socketPath.includes(':')) throw new Error('Metadata socket must be an absolute local Unix socket path without colons.');
  const state: OfficeSnapshot = emptySnapshot(`manual-metadata-${randomUUID()}`);
  state.source = 'codex';
  state.petAssets = structuredClone(builtInPets);
  state.projects = [...allowedCwds].map(cwd => ({ projectId: `cwd:${cwd}`, displayName: basename(cwd), cwd }));
  state.capabilities.observeAgents = { supported: true, reason: 'Read-only metadata polling; connection health is reported separately.' };
  state.capabilities.observeHandoffs = unsupported('Metadata polling does not establish handoffs.');
  state.capabilities.respondToRequests = unsupported('Read-only metadata observer. Use the original Codex conversation.');
  const listeners = new Set<(event: OfficeEvent) => void>();
  let rpc: MetadataRpc | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  function emit<T extends OfficeEvent['type']>(type: T, agentId: string | null, data: Extract<OfficeEvent, { type: T }>['data']) {
    const seq = ++state.lastSeq;
    const event = { protocolVersion: 1, bridgeEpoch: state.bridgeEpoch, seq, eventId: `${state.bridgeEpoch}:${seq}`,
      occurredAt: new Date().toISOString(), source: 'codex', type, agentId, data } as OfficeEvent;
    for (const listener of listeners) listener(structuredClone(event));
  }
  function connection(value: OfficeConnection) {
    const changed = state.connection.status !== value.status || state.connection.message !== value.message;
    state.connection = value;
    if (changed || value.status === 'connected') emit('connection.changed', null, { connection: value });
  }
  async function poll() {
    if (stopped) return;
    try {
      if (!rpc?.connected) {
        rpc?.close();
        connection({ status: 'reconnecting', lastObservedAt: state.connection.lastObservedAt, message: 'Connecting to the existing Codex daemon for metadata only.' });
        const connected = await MetadataRpc.connect(socketPath);
        if (stopped) { connected.close(); return; }
        rpc = connected;
      }
      const ids = new Set<string>();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const result = await rpc.call('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
        if (!object(result) || !Array.isArray(result.data) || !result.data.every(id => typeof id === 'string')) throw new Error('Invalid loaded-thread metadata response.');
        result.data.forEach(id => ids.add(id));
        cursor = text(result.nextCursor) ?? undefined;
        if (!cursor) break;
        if (cursors.has(cursor) || page === 4) throw new Error('Loaded-thread metadata exceeds the bounded observer limit.');
        cursors.add(cursor);
      }
      const observed = new Map<string, OfficeAgent>();
      // Small batches bound outstanding reads; only normalized allowlisted metadata is retained.
      const loadedIds = [...ids];
      for (let offset = 0; offset < loadedIds.length; offset += 8) {
        const rows = await Promise.all(loadedIds.slice(offset, offset + 8).map(threadId =>
          rpc!.call('thread/read', { threadId, includeTurns: false })));
        for (const result of rows) {
          if (!object(result) || !object(result.thread)) continue;
          const t = result.thread;
          const id = text(t.id), cwd = text(t.cwd);
          if (!id || !cwd || !allowedCwds.has(resolve(cwd))) continue;
          const parent = text(t.parentThreadId);
          const projectId = text(t.projectId) ?? `cwd:${resolve(cwd)}`;
          if (!state.projects.some(project => project.projectId === projectId)) state.projects.push({ projectId, displayName: basename(cwd), cwd });
          const assetIndex = createHash('sha256').update(id).digest()[0] % builtInPets.length;
          observed.set(id, { agentId: id, parentAgentId: parent, projectId,
            displayName: text(t.agentNickname) ?? text(t.name) ?? `${parent ? 'Subagent' : 'Agent'} ${id.slice(0, 8)}`,
            role: text(t.agentRole), task: null, runtimeState: runtime(t), activityKind: 'unknown', lastObservedAt: new Date().toISOString(),
            pendingRequestIds: [], petAssetId: builtInPets[assetIndex].assetId, recentActivity: [] });
        }
      }
      if (stopped) return;
      const previous = new Map(state.agents.map(agent => [agent.agentId, agent]));
      for (const [id, agent] of previous) {
        // Loaded-memory absence is not an observed completion or closure.
        if (!observed.has(id)) observed.set(id, { ...agent, runtimeState: 'unknown' });
      }
      state.agents = [...observed.values()];
      for (const agent of state.agents) {
        const prior = previous.get(agent.agentId);
        if (prior && prior.runtimeState !== agent.runtimeState) emit('agent.state.changed', agent.agentId, { runtimeState: agent.runtimeState });
        if (!prior || JSON.stringify(prior) !== JSON.stringify(agent)) emit('agent.upserted', agent.agentId, { agent });
      }
      connection({ status: 'connected', lastObservedAt: new Date().toISOString(),
        message: 'Live Codex metadata only, polled every 2 seconds. Task activity, request details and handoffs are unavailable.' });
    } catch (error) {
      if (stopped) return;
      rpc?.close(); rpc = null;
      connection({ status: 'disconnected', lastObservedAt: state.connection.lastObservedAt,
        message: error instanceof Error ? error.message : 'Codex metadata observation failed.' });
    } finally {
      if (!stopped) timer = setTimeout(() => { void poll(); }, POLL_MS);
    }
  }
  await poll();
  return {
    initialSnapshot: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { stopped = true; clearTimeout(timer); listeners.clear(); rpc?.close(); rpc = null; },
  };
}
