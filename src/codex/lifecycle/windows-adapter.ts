/** Passive lifecycle composition over the existing Windows metadata/activity adapter. */
import { randomUUID } from 'node:crypto';
import type { OfficeAdapter } from '../../server/adapter.js';
import type { OfficeEvent, OfficeSnapshot } from '../../shared/contract.js';
import { createOfficeStore } from '../../client/store.js';
import { isTurnLifecycleObservation, upsertLatestTurn, type TurnLifecycleObservation } from '../../shared/turn-lifecycle.js';
import { RolloutLifecycleReader } from './rollout-reader.js';

export interface LifecycleScan {
  observations: TurnLifecycleObservation[];
  latestTurns: TurnLifecycleObservation[];
  quarantined: number;
}
export interface WindowsLifecycleReader { scan(): Promise<LifecycleScan>; close(): void | Promise<void> }
export interface WindowsLifecycleOptions {
  base: OfficeAdapter;
  /** Owned by this wrapper; no session controls are exposed. */
  reader: WindowsLifecycleReader;
  pollMs?: number;
  now?: () => string;
}

export async function createWindowsTurnLifecycleAdapter(options: WindowsLifecycleOptions): Promise<OfficeAdapter> {
  const pollMs=options.pollMs??1000;
  if(!Number.isFinite(pollMs)||pollMs<10)throw new Error('Lifecycle poll interval must be at least 10ms.');
  const now=options.now??(()=>new Date().toISOString());
  const epoch='windows-lifecycle-'+randomUUID();
  const store=createOfficeStore();
  const listeners=new Set<(event:OfficeEvent)=>void>();
  const queued:OfficeEvent[]=[];
  const pending=new Map<string,TurnLifecycleObservation>();
  let latestTurns:TurnLifecycleObservation[]=[];
  let seq=0,observationGeneration=0,initialized=false,stopped=false,continuityFailed=false,needBaseline=true;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let connectionOverride:OfficeSnapshot['connection']|null=null;

  function snapshot():OfficeSnapshot {
    const source=store.getState().snapshot!;
    return structuredClone({...source,bridgeEpoch:epoch,lastSeq:seq,latestTurns,
      ...(connectionOverride?{connection:connectionOverride}:{})});
  }
  function publish(input:OfficeEvent) {
    if(stopped)return;
    const event={...structuredClone(input),bridgeEpoch:epoch,seq:++seq};
    for(const listener of [...listeners])try{listener(structuredClone(event));}catch{/* Isolate viewers. */}
  }
  function deliver(input:TurnLifecycleObservation,initial=false,forceHistory=false) {
    if(!isTurnLifecycleObservation(input)||input.source!=='codex')return;
    const known=latestTurns.find(row=>row.agentId===input.agentId)??pending.get(input.agentId);
    // A standalone null-start baseline cannot order any later distinct turn.
    // Keep it unestablished; only same-turn outcomes may inherit a known start.
    if(input.startedAt===null&&!(known?.turnId===input.turnId&&known.startedAt!==null))return;
    const source=store.getState().snapshot;
    if(!source?.agents.some(agent=>agent.agentId===input.agentId)) {
      // A source poll can precede metadata discovery by one cycle. Keep only
      // that agent's latest observation, never replay a completed unseen turn.
      const previous=pending.get(input.agentId);
      if(previous?.sourceEventId===input.sourceEventId&&previous.delivery==='live'&&input.delivery==='history'&&!forceHistory)return;
      const candidate=upsertLatestTurn(previous?[previous]:[],input)[0];
      if(previous&&candidate===previous&&previous.sourceEventId!==input.sourceEventId)return;
      if(pending.size<1000||pending.has(input.agentId))pending.set(input.agentId,structuredClone(forceHistory?{...candidate,delivery:'history'}:candidate));
      return;
    }
    let observation=structuredClone(input);
    const previous=latestTurns.find(row=>row.agentId===observation.agentId);
    if(forceHistory||(observation.status!=='started'&&previous?.turnId!==observation.turnId))observation.delivery='history';
    const next=upsertLatestTurn(latestTurns,observation);
    if(next===latestTurns) {
      if(previous?.sourceEventId!==observation.sourceEventId||observation.delivery!=='history'||!forceHistory)return;
    } else latestTurns=next;
    if(initial)return;
    publish({protocolVersion:1,bridgeEpoch:epoch,seq:0,eventId:randomUUID(),occurredAt:observation.occurredAt,
      source:'codex',type:'agent.turn.observed',agentId:observation.agentId,data:{observation}});
  }
  function flushPending() {
    if(!initialized||needBaseline||store.getState().snapshot?.connection.status!=='connected')return;
    for(const [id,observation] of [...pending])if(store.getState().snapshot!.agents.some(agent=>agent.agentId===id)) {
      pending.delete(id);deliver(observation,false,observation.status!=='started');
    }
  }
  function fromBase(event:OfficeEvent) {
    if(stopped||continuityFailed)return;
    if(!initialized){if(queued.length>=10_000)throw new Error('Lifecycle bootstrap queue exceeded.');queued.push(structuredClone(event));return;}
    const previous=store.getState().snapshot;
    store.applyEvent(event);
    const state=store.getState();
    if(state.error) {
      continuityFailed=true;pending.clear();needBaseline=true;
      connectionOverride={status:'disconnected',lastObservedAt:previous?.connection.lastObservedAt??null,message:'Observer event continuity lost; reopen Office.'};
      publish({protocolVersion:1,bridgeEpoch:epoch,seq:0,eventId:randomUUID(),occurredAt:now(),source:'codex',type:'connection.changed',agentId:null,data:{connection:connectionOverride}});
      return;
    }
    if(state.snapshot===previous)return;
    if(event.type==='connection.changed'&&event.data.connection.status!=='connected'){observationGeneration++;needBaseline=true;pending.clear();}
    if(event.type==='agent.turn.observed') {
      const observation=event.data.observation;
      if(observation.source!==state.snapshot!.source||!state.snapshot!.agents.some(agent=>agent.agentId===observation.agentId))return;
      const previous=latestTurns.find(row=>row.agentId===observation.agentId);
      if(observation.startedAt===null&&!(previous?.turnId===observation.turnId&&previous.startedAt!==null))return;
      const next=upsertLatestTurn(latestTurns,observation);
      if(next===latestTurns&&(previous?.sourceEventId!==observation.sourceEventId||observation.delivery==='live'))return;
      latestTurns=next;
    }
    publish(event);flushPending();
  }
  async function scan(initial=false) {
    const source=store.getState().snapshot;
    if(stopped||continuityFailed||source?.connection.status!=='connected')return;
    const generation=observationGeneration;
    let result:LifecycleScan;
    try{result=await options.reader.scan();}catch{needBaseline=true;pending.clear();return;}
    if(stopped||continuityFailed||observationGeneration!==generation||store.getState().snapshot?.connection.status!=='connected')return;
    const baseline=needBaseline||initial;
    if(baseline) {
      for(const observation of result.latestTurns)deliver({...observation,delivery:'history'},initial,true);
      needBaseline=false;
    } else {
      for(const observation of result.observations)deliver(observation);
      // Silent discovery of source truth skipped before metadata joined the roster.
      for(const observation of result.latestTurns)if(!latestTurns.some(row=>row.agentId===observation.agentId))deliver({...observation,delivery:'history'});
    }
    flushPending();
  }
  const unsubscribe=options.base.subscribe(fromBase);
  async function stop(){if(stopped)return;stopped=true;clearTimeout(timer);unsubscribe();listeners.clear();pending.clear();await Promise.all([options.reader.close(),options.base.stop()]);}
  try {
    const initial=await options.base.initialSnapshot();
    if(initial.source!=='codex')throw new Error('Windows lifecycle requires a Codex metadata source.');
    store.applySnapshot(initial);
    if(store.getState().error||!store.getState().snapshot)throw new Error('Invalid lifecycle base snapshot.');
    latestTurns=structuredClone((initial.latestTurns??[]).filter(row=>row.startedAt!==null));initialized=true;
    for(const event of queued)fromBase(event);queued.length=0;
    await scan(true);
    const tick=async()=>{try{await scan();}finally{if(!stopped&&!continuityFailed)timer=setTimeout(()=>void tick(),pollMs);}};
    if(!stopped&&!continuityFailed)timer=setTimeout(()=>void tick(),pollMs);
    return {initialSnapshot:snapshot,subscribe(listener){if(!stopped)listeners.add(listener);return()=>listeners.delete(listener);},stop};
  }catch(error){await stop();throw error;}
}

/** PR35 remains the base adapter; no modification to its reader or active services. */
export async function createAdapter(options:{createBase?:()=>Promise<OfficeAdapter>;pollMs?:number;now?:()=>string}={}):Promise<OfficeAdapter> {
  const root=process.env.PETSTOWN_ROLLOUT_ROOT;
  const paths:unknown=JSON.parse(process.env.PETSTOWN_ROLLOUT_FILES??(root?'[]':'null'));
  const cwds:unknown=JSON.parse(process.env.PETSTOWN_METADATA_CWDS??JSON.stringify([process.cwd()]));
  if(!Array.isArray(paths)||!paths.every(value=>typeof value==='string')||!Array.isArray(cwds)||!cwds.every(value=>typeof value==='string'))throw new Error('Invalid lifecycle rollout scope.');
  let discover:(()=>Promise<string[]>)|undefined;
  if(root){const modulePath='../rollout-discovery.js';const module=await import(modulePath);discover=()=>module.discoverRollouts(root);}
  const reader=new RolloutLifecycleReader({paths,discover,allowedCwds:cwds,sourceNamespace:'codex-desktop-rollout-lifecycle-v1',now:options.now});
  let base:OfficeAdapter;
  try {
    if(options.createBase)base=await options.createBase();
    else {const modulePath='../activity/windows-adapter.js';const module=await import(modulePath);base=await module.createAdapter();}
  }catch(error){await reader.close();throw error;}
  return createWindowsTurnLifecycleAdapter({base,reader,pollMs:options.pollMs,now:options.now});
}
