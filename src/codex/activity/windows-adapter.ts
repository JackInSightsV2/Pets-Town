/** Opt-in passive rollout activity observer; it never controls Codex work. */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { ActivityEntry, OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import { createMetadataAdapter, type MetadataReader } from '../metadata-adapter.js';
import { canonicalizeCwd } from '../observer-normalization.js';
import { discoverRollouts } from '../rollout-discovery.js';
import { RolloutReader } from '../rollout-reader.js';
import { readNativeThreadNames, withNativeThreadNames } from '../native-thread-names.js';
import { RolloutActivityNormalizer } from './rollout-activity.js';

const merge = (entries: ActivityEntry[]) => {
  const seen = new Set<string>();
  return entries.filter(e => !seen.has(e.activityId) && !!seen.add(e.activityId)).sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 50);
};

export async function createWindowsActivityAdapter(options: { files: string[]; root?: string; cwds: string[]; pollMs?: number; now?: () => string; nameIndex?: string | null; wrapReader?: (reader: MetadataReader) => MetadataReader }): Promise<OfficeAdapter> {
  const allowed = new Set(options.cwds.map(canonicalizeCwd));
  if (!allowed.size || allowed.has(null)) throw new Error('Invalid activity scope.');
  const normalizer = new RolloutActivityNormalizer('codex-rollout-command-v1', options.now);
  let pending: ActivityEntry[] = [], activityFailed = false;
  let activityFailureNotified = false;
  let activeReader: RolloutReader | undefined;
  let pollComplete = () => {};
  const nameIndex = options.nameIndex === undefined ? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'session_index.jsonl') : options.nameIndex;
  const base = await createMetadataAdapter({ allowedCwds: options.cwds, pollMs: options.pollMs, now: options.now,
    onPollComplete: () => pollComplete(),
    sourceDescription: 'Existing Codex session logs; completed command activity is observed without command details.',
    connect: async () => {
      const reader = new RolloutReader(options.files, options.root ? () => discoverRollouts(options.root!) : undefined, (threadId, cwd, batch) => {
      if (activityFailed || !allowed.has(canonicalizeCwd(cwd))) return;
      try {
        const entries = normalizer.commit(batch, threadId, threadId);
        if (pending.length + entries.length > 10_000) throw new Error('Activity queue capacity exceeded.');
        pending.push(...entries);
      } catch { activityFailed = true; pending = []; }
      });
      activeReader = reader;
      const named = nameIndex ? withNativeThreadNames(reader, { allowedCwds: options.cwds, readNames: ids => readNativeThreadNames(nameIndex, ids) }) : reader;
      return options.wrapReader ? options.wrapReader(named) : named;
    } });
  const listeners = new Set<(event: OfficeEvent) => void>();
  const queued: OfficeEvent[] = [];
  const epoch = 'rollout-activity-' + randomUUID();
  let state: OfficeSnapshot | undefined, baseEpoch = '', baseSeq = 0, stopped = false, continuityFailed = false;
  function publish(input: OfficeEvent) {
    if (!state || stopped) return;
    const event = structuredClone(input); event.bridgeEpoch = epoch; event.seq = ++state.lastSeq;
    switch (event.type) {
      case 'project.upserted': state.projects = [...state.projects.filter(p => p.projectId !== event.data.project.projectId), event.data.project]; break;
      case 'agent.upserted': {
        const old = state.agents.find(a => a.agentId === event.data.agent.agentId);
        event.data.agent.recentActivity = merge([...event.data.agent.recentActivity, ...(old?.recentActivity ?? [])]);
        state.agents = [...state.agents.filter(a => a.agentId !== event.data.agent.agentId), event.data.agent]; break;
      }
      case 'connection.changed':
        if (activityFailed) { event.data.connection.message = 'Command activity unavailable; reopen Office to retry. Metadata observation continues.'; activityFailureNotified = true; }
        state.connection = event.data.connection; break;
      default: break;
    }
    for (const listener of [...listeners]) try { listener(structuredClone(event)); } catch { /* Isolate consumers. */ }
  }
  function flush() {
    if (!state) return;
    if (activityFailed && !activityFailureNotified) {
      activityFailureNotified = true;
      publish({ protocolVersion:1, bridgeEpoch:epoch, seq:0, eventId:randomUUID(), occurredAt:(options.now ?? (() => new Date().toISOString()))(),
        source:'codex', type:'connection.changed', agentId:null, data:{ connection:{ ...state.connection, message:'Command activity unavailable; reopen Office to retry. Metadata observation continues.' } } });
    }
    if (activityFailed) { pending = []; return; }
    const ready = pending; pending = [];
    for (const activity of ready) {
      if (!activeReader?.hasVerifiedThread(activity.agentId, allowed)) continue;
      const agent = state.agents.find(a => a.agentId === activity.agentId);
      if (!agent) continue;
      publish({ protocolVersion: 1, bridgeEpoch: epoch, seq: 0, eventId: activity.activityId, occurredAt: activity.occurredAt,
        source:'codex', type:'agent.upserted', agentId:agent.agentId, data:{ agent:{ ...agent, recentActivity:merge([activity, ...agent.recentActivity]) } } });
    }
  }
  function fromBase(event: OfficeEvent) {
    if (stopped || continuityFailed) return;
    if (!state) { queued.push(structuredClone(event)); return; }
    if (event.bridgeEpoch === baseEpoch && event.seq <= baseSeq) return;
    if (event.bridgeEpoch !== baseEpoch || event.seq !== baseSeq + 1) {
      continuityFailed = true; pending = [];
      publish({protocolVersion:1,bridgeEpoch:epoch,seq:0,eventId:randomUUID(),occurredAt:new Date().toISOString(),source:'codex',type:'connection.changed',agentId:null,
        data:{connection:{...state.connection,status:'disconnected',message:'Observer event continuity lost; reopen Office.'}}}); return;
    }
    baseSeq = event.seq; publish(event);
  }
  const unsubscribe = base.subscribe(fromBase);
  try {
    const initial = await base.initialSnapshot();
    baseEpoch = initial.bridgeEpoch; baseSeq = initial.lastSeq; state = { ...initial, bridgeEpoch:epoch, lastSeq:0 };
    for (const event of queued) fromBase(event); queued.length = 0;
    pollComplete = flush;
    flush();
    return { initialSnapshot:()=>structuredClone(state!), subscribe(listener) { if (!stopped) listeners.add(listener); return ()=>listeners.delete(listener); },
      async stop() { if (stopped) return; stopped = true; unsubscribe(); listeners.clear(); pending = []; await base.stop(); } };
  } catch (error) { unsubscribe(); await base.stop(); throw error; }
}

export async function createAdapter(): Promise<OfficeAdapter> {
  const root = process.env.PETSTOWN_ROLLOUT_ROOT;
  const files: unknown = JSON.parse(process.env.PETSTOWN_ROLLOUT_FILES ?? (root ? '[]' : 'null'));
  const cwds: unknown = process.env.PETSTOWN_METADATA_CWDS ? JSON.parse(process.env.PETSTOWN_METADATA_CWDS) : [process.cwd()];
  if (!Array.isArray(files) || !files.every(p => typeof p === 'string') || !Array.isArray(cwds) || !cwds.every(p => typeof p === 'string')) throw new Error('Invalid rollout observer options.');
  return createWindowsActivityAdapter({ files, root, cwds });
}
