/** Explicit passive Mac composition; the base retains existing handoff/activity behavior. */
import { createAdapter as createLiveHandoffAdapter } from '../live-handoff-adapter.js';
import { createMacHistoryReader, type MacHistoryReader, type MacHistoryReaderOptions } from '../handoffs/mac-history-reader.js';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { OfficeEvent } from '../../shared/contract.js';
import { createTurnLifecycleHistoryAdapter } from './history-adapter.js';

export interface MacLifecycleAdapterOptions {
  createBase?: () => Promise<OfficeAdapter>;
  createReader?: (options: MacHistoryReaderOptions) => Promise<MacHistoryReader>;
  pollMs?: number;
  now?: () => string;
}

export async function createAdapter(options: MacLifecycleAdapterOptions = {}): Promise<OfficeAdapter> {
  const rawBase = await (options.createBase ?? createLiveHandoffAdapter)();
  let baseStopped = false;
  const base: OfficeAdapter = {
    initialSnapshot: rawBase.initialSnapshot.bind(rawBase),
    subscribe: rawBase.subscribe.bind(rawBase),
    async stop() { if (!baseStopped) { baseStopped = true; await rawBase.stop(); } },
  };
  const scoped = new Set<string>();
  const queued: OfficeEvent[] = [];
  let seeded = false, connected = false, scopeFailed = false, detached = false;
  let epoch = '', seq = 0;
  function observe(event: OfficeEvent) {
    if (detached || scopeFailed) return;
    if (!seeded) { queued.push(structuredClone(event)); return; }
    if (event.bridgeEpoch === epoch && event.seq <= seq) return;
    if (event.bridgeEpoch !== epoch || event.seq !== seq + 1) { scopeFailed = true; connected = false; return; }
    seq = event.seq;
    // Runtime error/unknown/closed does not remove a row from the observed scope
    // and is not evidence of its latest turn outcome.
    if (event.type === 'agent.upserted') scoped.add(event.data.agent.agentId);
    if (event.type === 'connection.changed') connected = event.data.connection.status === 'connected';
  }
  const unsubscribe = base.subscribe(observe);
  function detachScope() {
    if (detached) return;
    detached = true;
    connected = false;
    scoped.clear();
    unsubscribe();
  }
  let rawReader: MacHistoryReader | undefined;
  let readerClosed = false;
  async function closeReader() {
    if (readerClosed) return;
    readerClosed = true;
    await rawReader?.close();
  }
  try {
    const snapshot = await base.initialSnapshot();
    epoch = snapshot.bridgeEpoch;
    seq = snapshot.lastSeq;
    snapshot.agents.forEach(agent => scoped.add(agent.agentId));
    connected = snapshot.connection.status === 'connected';
    seeded = true;
    for (const event of queued) observe(event);
    queued.length = 0;
    if (snapshot.source !== 'codex') { detachScope(); return base; }
    try {
      rawReader = await (options.createReader ?? createMacHistoryReader)({
        isAllowed: id => !detached && !scopeFailed && connected && scoped.has(id),
      });
    } catch {
      // Optional lifecycle reads cannot disable the existing metadata/handoff base.
      detachScope();
      return base;
    }
    const reader = {
      get generation() { return rawReader!.generation; },
      read: rawReader.read.bind(rawReader),
      close: closeReader,
    };
    const adapter = await createTurnLifecycleHistoryAdapter({ base, reader,
      sourceNamespace: 'codex-0.166.0-projected-turn-lifecycle',
      sourceVerified: rawReader.version === '0.166.0', pollMs: options.pollMs, now: options.now,
    });
    return { ...adapter, async stop() { detachScope(); await adapter.stop(); } };
  } catch (error) {
    detachScope();
    await Promise.all([closeReader(), base.stop()]);
    throw error;
  }
}
