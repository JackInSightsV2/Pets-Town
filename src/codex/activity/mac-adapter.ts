/** Opt in with --adapter ./src/codex/activity/mac-adapter.ts. */
import { createAdapter as createBase } from '../live-handoff-adapter.js';
import { createMacHistoryReader } from '../handoffs/mac-history-reader.js';
import type { OfficeAgent } from '../../shared/contract.js';
import { createActivityHistoryAdapter } from './history-adapter.js';

export async function createAdapter() {
  const base = await createBase();
  const allowed = new Set<string>();
  let ready = false;
  const queued: Parameters<Parameters<typeof base.subscribe>[0]>[0][] = [];
  const observe = (agent: OfficeAgent) => {
    if (['unknown', 'closed', 'error'].includes(agent.runtimeState)) allowed.delete(agent.agentId);
    else allowed.add(agent.agentId);
  };
  const apply = (event: Parameters<Parameters<typeof base.subscribe>[0]>[0]) => {
    if (event.type === 'agent.upserted') observe(event.data.agent);
    if (event.type === 'agent.closed' && event.agentId) allowed.delete(event.agentId);
    if (event.type === 'agent.state.changed' && event.agentId) {
      if (['unknown', 'closed', 'error'].includes(event.data.runtimeState)) allowed.delete(event.agentId);
      else allowed.add(event.agentId);
    }
    if (event.type === 'connection.changed' && event.data.connection.status !== 'connected') allowed.clear();
  };
  const unsubscribe = base.subscribe(event => { if (ready) apply(event); else queued.push(event); });
  let reader: Awaited<ReturnType<typeof createMacHistoryReader>> | undefined;
  try {
    const snapshot = await base.initialSnapshot();
    snapshot.agents.forEach(observe);
    ready = true;
    for (const event of queued) if (event.bridgeEpoch === snapshot.bridgeEpoch && event.seq > snapshot.lastSeq) apply(event);
    queued.length = 0;
    reader = await createMacHistoryReader({ isAllowed: id => allowed.has(id) });
    const adapter = await createActivityHistoryAdapter({ base, reader, sourceNamespace: 'codex-0.166.0-command-history' });
    return { ...adapter, async stop() { unsubscribe(); await adapter.stop(); } };
  } catch (error) { unsubscribe(); await reader?.close(); await base.stop(); throw error; }
}
