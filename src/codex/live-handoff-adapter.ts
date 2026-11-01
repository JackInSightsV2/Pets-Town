/** Explicit Mac observer composition; never creates or resumes agent work. */
import { createAdapter as createMetadataAdapter } from './metadata-adapter.js';
import { createHandoffHistoryAdapter } from './handoffs/history-adapter.js';
import { createMacHistoryReader } from './handoffs/mac-history-reader.js';
import { unsupported, type OfficeAgent } from '../shared/contract.js';

export async function createAdapter(options: { createBase?: typeof createMetadataAdapter; createReader?: typeof createMacHistoryReader } = {}) {
  const base = await (options.createBase ?? createMetadataAdapter)();
  const allowed = new Set<string>();
  const observe = (agent: OfficeAgent) => {
    if (['unknown', 'closed', 'error'].includes(agent.runtimeState)) allowed.delete(agent.agentId);
    else allowed.add(agent.agentId);
  };
  const snapshot = await base.initialSnapshot();
  snapshot.agents.forEach(observe);
  const unsubscribe = base.subscribe(event => {
    if (event.type === 'agent.upserted') observe(event.data.agent);
    if (event.type === 'agent.closed') allowed.delete(event.agentId!);
    if (event.type === 'agent.state.changed' && event.agentId) {
      if (['unknown', 'closed', 'error'].includes(event.data.runtimeState)) allowed.delete(event.agentId);
      else allowed.add(event.agentId);
    }
    if (event.type === 'connection.changed' && event.data.connection.status !== 'connected') allowed.clear();
  });
  let reader: Awaited<ReturnType<typeof createMacHistoryReader>> | undefined;
  try {
    reader = await (options.createReader ?? createMacHistoryReader)({ isAllowed: id => allowed.has(id) });
  } catch {
    // The optional handoff socket can fail independently of the metadata observer.
    unsubscribe();
    return {
      async initialSnapshot() {
        const current = await base.initialSnapshot();
        return { ...current, capabilities: { ...current.capabilities,
          observeHandoffs: unsupported('Mac handoff reader could not connect or verify the runtime; metadata remains available.') } };
      },
      subscribe: base.subscribe.bind(base),
      stop: base.stop.bind(base),
    };
  }
  try {
    const adapter = await createHandoffHistoryAdapter({ base, reader,
      sourceNamespace: 'codex-0.166.0-subAgentActivity-interacted',
      // Exact release receipt/history projection audited in docs/evidence/codex-0166-handoff-source.md.
      sourceVerified: reader.version === '0.166.0',
    });
    return { ...adapter, async stop() { unsubscribe(); await adapter.stop(); } };
  } catch (error) {
    unsubscribe(); await reader?.close(); await base.stop(); throw error;
  }
}
