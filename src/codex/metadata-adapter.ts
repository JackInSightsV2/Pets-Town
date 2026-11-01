/** Read-only observer promoted from Jack's manual metadata probe. */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { OfficeAdapter } from '../server/adapter.js';
import { emptySnapshot, unsupported, type OfficeAgent, type OfficeConnection, type OfficeEvent } from '../shared/contract.js';
import { builtInPets } from '../shared/pets.js';
import { MetadataRpc } from './metadata-rpc.js';
import { agentSemanticFingerprint, canonicalizeCwd, normalizeThreadMetadata } from './observer-normalization.js';

export interface MetadataReader {
  readonly connected: boolean;
  call(method: 'thread/loaded/list' | 'thread/read', params: Record<string, unknown>): Promise<unknown>;
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
  let bootstrapped = false;
  function emit(type: 'agent.upserted' | 'connection.changed', agentId: string | null, data: unknown) {
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
      // Office v1 currently cannot stream project metadata. Catalogue is atomic with the initial snapshot.
      if (!bootstrapped) for (const row of observed.values()) {
        if (!state.projects.some(project => project.projectId === row.project.projectId)) state.projects.push(row.project);
      }
      let deferredProjects = false;
      for (const row of observed.values()) {
        if (!state.projects.some(project => project.projectId === row.project.projectId)) { deferredProjects = true; continue; }
        upsert(row.agent);
      }
      for (const previous of [...state.agents]) {
        if (!observed.has(previous.agentId)) upsert({ ...previous, runtimeState: 'unknown' });
      }
      connection({ status: 'connected', lastObservedAt: observedAt, message: deferredProjects
        ? 'Metadata only. A new project was observed; reopen Office to include its project metadata.'
        : (options.sourceDescription ?? 'Live metadata polling. Item activity, request details and handoffs are unavailable.') });
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
    initialSnapshot() { bootstrapped = true; return structuredClone(state); },
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
