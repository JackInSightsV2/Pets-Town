/** Read-only observer promoted from Jack's manual metadata probe. */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { OfficeAdapter } from '../server/adapter.js';
import { emptySnapshot, unsupported, type OfficeAgent, type OfficeConnection, type OfficeEvent, type OfficeProject } from '../shared/contract.js';
import { builtInPets } from '../shared/pets.js';
import { MetadataRpc, MetadataRpcError } from './metadata-rpc.js';
import { agentSemanticFingerprint, canonicalizeCwd, normalizeThreadMetadata } from './observer-normalization.js';

export interface MetadataReader {
  readonly connected: boolean;
  readonly healthMessage?: string;
  call(method: 'thread/loaded/list' | 'thread/read' | 'thread/goal/get', params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}
export interface MetadataAdapterOptions {
  allowedCwds: readonly string[];
  connect: () => Promise<MetadataReader>;
  sourceDescription?: string;
  pollMs?: number;
  now?: () => string;
}
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Injectable read-only boundary for tests and future verified discovery transports. */
export async function createMetadataAdapter(options: MetadataAdapterOptions): Promise<OfficeAdapter> {
  const allowedCwds = options.allowedCwds.map(canonicalizeCwd);
  if (!allowedCwds.length || allowedCwds.some(cwd => !cwd)) throw new Error('Observer directories must be absolute.');
  const now = options.now ?? (() => new Date().toISOString());
  const pollMs = options.pollMs ?? 2000;
  if (!Number.isFinite(pollMs) || pollMs < 10) throw new Error('Poll interval must be at least 10ms.');
  const state = emptySnapshot('metadata-' + randomUUID());
  state.petAssets = structuredClone(builtInPets);
  state.capabilities.observeAgents = { supported: true, reason: options.sourceDescription ?? 'Read-only metadata polling; connection health is separate.' };
  state.capabilities.observeHandoffs = unsupported('Metadata polling does not establish handoffs.');
  state.capabilities.respondToRequests = unsupported('Metadata cannot read or answer requests. Use the original Codex conversation.');
  const listeners = new Set<(event: OfficeEvent) => void>();
  let rpc: MetadataReader | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let goalMethodSupported = true;
  function emit(type: 'agent.upserted' | 'project.upserted' | 'connection.changed', agentId: string | null, data: unknown) {
    if (stopped) return;
    const seq = ++state.lastSeq;
    const event = { protocolVersion: 1, bridgeEpoch: state.bridgeEpoch, seq,
      eventId: state.bridgeEpoch + ':' + seq, occurredAt: now(), source: 'codex', type, agentId, data } as OfficeEvent;
    for (const listener of [...listeners]) {
      if (stopped) break;
      try { listener(structuredClone(event)); } catch { /* Consumers cannot stop observation. */ }
    }
  }
  function connection(value: OfficeConnection) {
    if (stopped) return;
    const changed = JSON.stringify(state.connection) !== JSON.stringify(value);
    state.connection = value;
    if (changed) emit('connection.changed', null, { connection: value });
  }
  function upsert(agent: OfficeAgent) {
    if (stopped) return;
    const index = state.agents.findIndex(previous => previous.agentId === agent.agentId);
    const previous = state.agents[index];
    if (previous && agentSemanticFingerprint(previous) === agentSemanticFingerprint(agent)) return;
    if (index < 0) state.agents.push(agent); else state.agents[index] = agent;
    // Apply exactly one row before numbering/notifying: a synchronous snapshot has the matching cursor.
    emit('agent.upserted', agent.agentId, { agent });
  }
  function upsertProject(project: OfficeProject) {
    if (stopped) return;
    const index = state.projects.findIndex(previous => previous.projectId === project.projectId);
    if (index >= 0 && JSON.stringify(state.projects[index]) === JSON.stringify(project)) return;
    if (index < 0) state.projects.push(project); else state.projects[index] = project;
    emit('project.upserted', null, { project });
  }
  async function poll() {
    if (stopped) return;
    try {
      if (!rpc?.connected) {
        rpc?.close();
        connection({ status: 'reconnecting', lastObservedAt: state.connection.lastObservedAt, message: 'Connecting to the existing Codex metadata source.' });
        if (stopped) return;
        const connected = await options.connect();
        if (stopped) { connected.close(); return; }
        rpc = connected;
        goalMethodSupported = true;
      }
      const ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await rpc.call('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
        if (stopped) return;
        if (!object(result) || !Array.isArray(result.data) || !result.data.every(id => typeof id === 'string' && id.length > 0)
          || (result.nextCursor != null && typeof result.nextCursor !== 'string')) throw new Error('Invalid loaded metadata.');
        result.data.forEach(id => ids.add(id));
        cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
        if (!cursor) break;
        if (cursors.has(cursor) || page === 99) throw new Error('Metadata pagination limit.');
        cursors.add(cursor);
      }
      const observed = new Map<string, NonNullable<ReturnType<typeof normalizeThreadMetadata>>>();
      const observedAt = now();
      const loaded = [...ids];
      for (let offset = 0; offset < loaded.length; offset += 8) {
        const batch = loaded.slice(offset, offset + 8);
        const results = await Promise.all(batch.map(threadId => rpc!.call('thread/read', { threadId, includeTurns: false })));
        if (stopped) return;
        results.forEach((result, index) => {
          if (!object(result) || !object(result.thread) || result.thread.id !== batch[index]) throw new Error('Invalid thread metadata.');
          const row = normalizeThreadMetadata(result.thread, { allowedCwds: allowedCwds as string[], observedAt, petAssets: state.petAssets });
          if (row) observed.set(row.agent.agentId, row);
        });
      }
      // Optional goals are read only after cwd scoping. Bound the extra work to
      // 64 agents / 8 simultaneous requests; other tasks remain explicitly unknown.
      const goalRows = [...observed.values()].slice(0, 64);
      for (let offset = 0; goalMethodSupported && offset < goalRows.length; offset += 8) {
        await Promise.all(goalRows.slice(offset, offset + 8).map(async row => {
          try {
            const result = await rpc!.call('thread/goal/get', { threadId: row.agent.agentId });
            if (stopped) return;
            if (object(result) && object(result.goal) && result.goal.threadId === row.agent.agentId
              && result.goal.status === 'active' && typeof result.goal.objective === 'string'
              && result.goal.objective.trim()) row.agent.task = `Goal: ${result.goal.objective}`;
          } catch (error) {
            if (error instanceof MetadataRpcError && error.code === -32601) {
              goalMethodSupported = false;
              return;
            }
            throw error;
          }
        }));
        if (stopped) return;
      }
      if (!rpc.connected) throw new Error('Metadata connection lost during observation.');
      // Publish project identity before any agent that references it, including
      // discovery after an empty initial snapshot and changes within the scope.
      for (const row of observed.values()) upsertProject(row.project);
      for (const row of observed.values()) upsert(row.agent);
      for (const previous of [...state.agents]) {
        if (!observed.has(previous.agentId)) upsert({ ...previous, runtimeState: 'unknown' });
      }
      connection({ status: 'connected', lastObservedAt: observedAt,
        message: [options.sourceDescription ?? 'Live metadata polling. Item activity, request details and handoffs are unavailable.', rpc.healthMessage].filter(Boolean).join(' ') });
    } catch {
      if (stopped) return;
      rpc?.close(); rpc = null;
      connection({ status: 'disconnected', lastObservedAt: state.connection.lastObservedAt,
        message: 'Could not read the existing Codex metadata source. Existing agent state has been preserved.' });
    } finally {
      if (!stopped) timer = setTimeout(() => { void poll(); }, pollMs);
    }
  }
  await poll();
  return {
    initialSnapshot() { return structuredClone(state); },
    subscribe(listener) { if (!stopped) listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { stopped = true; clearTimeout(timer); listeners.clear(); rpc?.close(); rpc = null; },
  };
}

/** The existing --adapter loader invokes this factory without arguments. */
export async function createAdapter(): Promise<OfficeAdapter> {
  const paths: unknown = process.env.PETSTOWN_METADATA_CWDS ? JSON.parse(process.env.PETSTOWN_METADATA_CWDS) : [process.cwd()];
  if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) throw new Error('PETSTOWN_METADATA_CWDS must be a JSON array of absolute directories.');
  const socketPath = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
  if (process.platform === 'win32') {
    const state = emptySnapshot('metadata-unsupported-' + randomUUID());
    state.connection.message = 'This adapter requires an existing Unix daemon control socket. The Windows desktop stdio server is not attachable through this transport.';
    state.capabilities.observeAgents = unsupported(state.connection.message);
    return { initialSnapshot: () => structuredClone(state), subscribe: () => () => {}, stop() {} };
  }
  return createMetadataAdapter({ allowedCwds: paths, connect: () => MetadataRpc.connect(socketPath) });
}
