import { createServer, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { OfficeEvent, OfficeSnapshot, PresentationState } from '../shared/contract.js';
import { unsupported } from '../shared/contract.js';
import { createUnsupportedAdapter, type OfficeAdapter } from './adapter.js';

import { validEvent } from './validation.js';
import { builtInPets } from '../shared/pets.js';
import { upsertLatestTurn } from '../shared/turn-lifecycle.js';
import { isOfficeSnapshot } from '../client/validation.js';

export interface OfficeServerOptions { adapter?: OfficeAdapter; launchIdentity?: string; port?: number; distDir?: string; officeAssetPath?: string; replayLimit?: number; presentationStepMs?: number; petAssetFiles?: Readonly<Record<string, string>> }
export async function createOfficeServer(options: OfficeServerOptions = {}) {
  const adapter = options.adapter ?? createUnsupportedAdapter();
  let snapshot: OfficeSnapshot;
  const buffered: OfficeEvent[]=[];
  let sink=(event:OfficeEvent)=>{buffered.push(event);};
  let unsubscribe:()=>void=()=>{};
  try { unsubscribe=adapter.subscribe(event=>sink(event)); snapshot = structuredClone(await adapter.initialSnapshot()); } catch (error) { unsubscribe(); await adapter.stop(); throw error; }
  if (snapshot.latestTurns !== undefined && !isOfficeSnapshot(snapshot)) { unsubscribe(); await adapter.stop(); throw new Error('Invalid lifecycle snapshot.'); }
  const initialAdapterEpoch=snapshot.bridgeEpoch, initialAdapterSeq=snapshot.lastSeq;
  const epoch = randomUUID(), token = randomUUID();
  snapshot.bridgeEpoch = epoch; snapshot.lastSeq = 0; snapshot.controlToken = token;
  snapshot.officeSessionId = randomUUID(); snapshot.presentation = {state:'ready',canSkip:false};
  snapshot.capabilities.respondToRequests = unsupported('Replies are not verified for this bridge. Respond in the original Codex client.');
  const disableReply = () => snapshot.pendingRequests.forEach(request => { request.responseCapability = snapshot.capabilities.respondToRequests; });
  disableReply();
  for(const agent of snapshot.agents) agent.pendingRequestIds=[...new Set([...agent.pendingRequestIds,...snapshot.pendingRequests.filter(r=>r.agentId===agent.agentId).map(r=>r.requestId)])];
  const clients = new Set<ServerResponse>(), replay: OfficeEvent[] = [];
  const seen = new Set<string>();
  let adapterErrors=0;
  const petAssetFiles=new Map(Object.entries(options.petAssetFiles??{}));
  snapshot.petAssets=snapshot.petAssets.flatMap(pet=>{
    if(petAssetFiles.has(pet.assetId))return [{...pet,imageUrl:`/pet-assets/${encodeURIComponent(pet.assetId)}`}];
    const approved=builtInPets.find(item=>item.assetId===pet.assetId&&item.imageUrl===pet.imageUrl);
    return approved?[structuredClone(approved)]:[];
  });
  for(const agent of snapshot.agents)if(!snapshot.petAssets.some(pet=>pet.assetId===agent.petAssetId))agent.petAssetId=null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const encode = (event: OfficeEvent) => `id: ${epoch}:${event.seq}\nevent: office\ndata: ${JSON.stringify(event)}\n\n`;
  function publish(input: OfficeEvent) {
    // Adapters are an external boundary: incomplete observations cannot crash the HTTP bridge.
    let cloned: OfficeEvent;
    try {
      if(!validEvent(input))throw new Error('Invalid normalized event');
      cloned=structuredClone(input);
      JSON.stringify(cloned); // Reject non-serializable extra properties before writing SSE.
    } catch {
      adapterErrors++;
      publish({protocolVersion:1,bridgeEpoch:epoch,seq:0,eventId:randomUUID(),occurredAt:new Date().toISOString(),source:'office',type:'connection.changed',agentId:null,data:{connection:{status:'reconnecting',lastObservedAt:snapshot.connection.lastObservedAt,message:'An invalid adapter observation was rejected. Existing agent and request state has been preserved.'}}});
      return;
    }
    if (seen.has(input.eventId)) return;
    if (input.type === 'agent.turn.observed' && (input.source !== snapshot.source || !snapshot.agents.some(agent => agent.agentId === input.agentId))) {
      adapterErrors++;
      return;
    }
    if (input.source==='fixture') snapshot.source='fixture';
    seen.add(input.eventId);
    // Bounded deduplication, like the bounded replay window.
    if (seen.size > 10000) seen.delete(seen.values().next().value!);
    const event = cloned; event.bridgeEpoch = epoch; event.seq = ++snapshot.lastSeq;
    const agent = snapshot.agents.find(a => a.agentId === event.agentId);
    switch(event.type) {
      case 'agent.upserted': { const incoming=event.data.agent; const i = snapshot.agents.findIndex(a => a.agentId === incoming.agentId); incoming.pendingRequestIds=[...new Set([...incoming.pendingRequestIds,...(snapshot.agents[i]?.pendingRequestIds??[]),...snapshot.pendingRequests.filter(r=>r.agentId===incoming.agentId).map(r=>r.requestId)])]; if(i<0) snapshot.agents.push(incoming); else snapshot.agents[i]=incoming; break; }
      case 'agent.activity': if(agent) { agent.activityKind=event.data.activity.kind; agent.recentActivity=[event.data.activity,...agent.recentActivity.filter(a=>a.activityId!==event.data.activity.activityId)].slice(0,50); agent.lastObservedAt=event.occurredAt; } break;
      case 'agent.state.changed': if(agent) {agent.runtimeState=event.data.runtimeState;agent.lastObservedAt=event.occurredAt;} break;
      case 'agent.turn.observed': snapshot.latestTurns=upsertLatestTurn(snapshot.latestTurns,event.data.observation); break;
      case 'agent.closed': if(agent) agent.runtimeState='closed'; break;
      case 'request.opened': snapshot.pendingRequests=snapshot.pendingRequests.filter(r=>r.requestId!==event.data.request.requestId); event.data.request.responseCapability=snapshot.capabilities.respondToRequests; snapshot.pendingRequests.push(event.data.request); {const owner=snapshot.agents.find(a=>a.agentId===event.data.request.agentId);if(owner&&!owner.pendingRequestIds.includes(event.data.request.requestId))owner.pendingRequestIds.push(event.data.request.requestId);} break;
      case 'request.resolved': { const owners=new Set([...snapshot.pendingRequests.filter(r=>r.requestId===event.data.requestId).map(r=>r.agentId),...snapshot.agents.filter(a=>a.pendingRequestIds.includes(event.data.requestId)).map(a=>a.agentId)]); if(event.agentId!==null&&[...owners].some(id=>id!==event.agentId)) { snapshot.lastSeq--; return; } snapshot.pendingRequests=snapshot.pendingRequests.filter(r=>r.requestId!==event.data.requestId); for(const owner of snapshot.agents) owner.pendingRequestIds=owner.pendingRequestIds.filter(id=>id!==event.data.requestId); break; }
      case 'project.upserted': snapshot.projects=[...snapshot.projects.filter(p=>p.projectId!==event.data.project.projectId),event.data.project]; break;
      case 'handoff.observed': snapshot.recentHandoffs=[event.data.handoff,...snapshot.recentHandoffs.filter(h=>h.handoffId!==event.data.handoff.handoffId)].slice(0,50); break;
      case 'capabilities.changed': event.data.capabilities.respondToRequests=snapshot.capabilities.respondToRequests; snapshot.capabilities=event.data.capabilities; disableReply(); break;
      case 'connection.changed': snapshot.connection=event.data.connection; break;
      case 'presentation.changed': snapshot.presentation={state:event.data.state,canSkip:event.data.canSkip}; snapshot.officeSessionId=event.data.officeSessionId; break;
    }
    replay.push(event); if(replay.length>(options.replayLimit??500)) replay.shift();
    for(const response of clients) { if (!response.write(encode(event))) { clients.delete(response); response.destroy(); } }
  }
  function presentation(state: PresentationState) {
    publish({protocolVersion:1,bridgeEpoch:epoch,seq:0,eventId:randomUUID(),occurredAt:new Date().toISOString(),source:'office',type:'presentation.changed',agentId:null,data:{officeSessionId:snapshot.officeSessionId,state,canSkip:state==='arrivals'||state==='standup'}});
  }
  sink=publish;
  for(const event of buffered) if(!event||event.bridgeEpoch!==initialAdapterEpoch||event.seq>initialAdapterSeq)publish(event);
  buffered.length=0;
  const json = (response: ServerResponse,status:number,value:unknown) => {response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
  const server = createServer(async (request,response) => {
    const host=request.headers.host??'';
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(response,403,{error:'Loopback host required'});
    const origin=`http://${host}`;
    if(request.headers.origin && request.headers.origin!==origin) return json(response,403,{error:'Same-origin request required'});
    const url=new URL(request.url??'/',origin);
    if(request.method==='POST') {
      const supplied=request.headers['x-office-token'];
      if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))) return json(response,403,{error:'Office token required'});
      if(url.pathname.startsWith('/api/requests/')) return json(response,501,{error:'unsupported',reason:snapshot.capabilities.respondToRequests.reason});
      const action=url.pathname.match(/^\/api\/presentation\/(start|skip|reset)$/)?.[1];
      if(!action) return json(response,404,{error:'Unknown action'});
      if(action==='start'&&snapshot.presentation.state==='ready') {presentation('arrivals');timer=setTimeout(()=>{presentation('standup');timer=setTimeout(()=>presentation('live'),options.presentationStepMs??2500);},options.presentationStepMs??2500);}
      if(action==='skip'&&snapshot.presentation.canSkip) {clearTimeout(timer);presentation('live');}
      if(action==='reset'&&snapshot.presentation.state!=='ready') {clearTimeout(timer);snapshot.officeSessionId=randomUUID();presentation('ready');}
      return json(response,200,{officeSessionId:snapshot.officeSessionId,presentation:snapshot.presentation});
    }
    if(request.method!=='GET') return json(response,405,{error:'Method not allowed'});
    if(url.pathname==='/api/health') return json(response,200,{service:'petstown-office',protocolVersion:1,bridgeEpoch:epoch,source:snapshot.source,adapterErrors,launchIdentity:options.launchIdentity});
    if(url.pathname==='/api/office') return json(response,200,snapshot);
    if(url.pathname==='/api/events') {
      const cursor=request.headers['last-event-id']??url.searchParams.get('cursor');
      let seq=snapshot.lastSeq;
      if(cursor) {
        const match=String(cursor).match(/^(.+):(\d+)$/);seq=match?Number(match[2]):-1;
        if(!match||match[1]!==epoch||seq>snapshot.lastSeq||seq<0||seq<(replay[0]?.seq??snapshot.lastSeq+1)-1) return json(response,409,{error:'snapshot_required',bridgeEpoch:epoch});
      }
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      response.write(': connected\n\n');for(const event of replay) if(event.seq>seq) response.write(encode(event));
      clients.add(response);request.on('close',()=>clients.delete(response));return;
    }
    if(url.pathname.startsWith('/api/')) return json(response,404,{error:'Unknown endpoint'});
    try {
      let file:string;
      if(url.pathname.startsWith('/pet-assets/')) {
        const assetId=decodeURIComponent(url.pathname.slice('/pet-assets/'.length));
        const approved=petAssetFiles.get(assetId);
        if(!approved)return json(response,404,{error:'Unknown pet asset'});
        file=approved;
      }
      else if(url.pathname==='/assets/office/office-v1.png'&&options.officeAssetPath) file=options.officeAssetPath;
      else {
        if(!options.distDir) return json(response,503,{error:'Frontend not built. Run npm run build, or use the Vite development server.'});
        const root=await realpath(options.distDir);
        const decoded=decodeURIComponent(url.pathname);
        if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').includes('..')) return json(response,403,{error:'Invalid asset path'});
        file=await realpath(resolve(root,`.${decoded==='/'?'/index.html':decoded}`));
        if(!file.startsWith(root+sep)) return json(response,403,{error:'Invalid asset path'});
      }
      if(!(await stat(file)).isFile()) return json(response,404,{error:'Not found'});
      const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
      const content=await readFile(file);
      response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});response.end(content);
    } catch {json(response,404,{error:'Not found'});}
  });
  const heartbeat=setInterval(()=>{for(const response of clients) response.write(': heartbeat\n\n');},15000);heartbeat.unref();
  let stopped=false;
  async function close() {if(stopped)return;stopped=true;clearInterval(heartbeat);clearTimeout(timer);unsubscribe();for(const response of clients) response.end();clients.clear();await new Promise<void>(done=>server.close(()=>done()));await adapter.stop();}
  try {await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.off('error',reject);done();});});} catch(error) {await close();throw error;}
  const address=server.address();if(!address||typeof address==='string') throw new Error('Missing server address');
  return {url:`http://127.0.0.1:${address.port}`,port:address.port,getSnapshot: () => structuredClone(snapshot),
    getEventsAfter: (bridgeEpoch: string, seq: number): OfficeEvent[] | null => {
      if (bridgeEpoch !== epoch || !Number.isSafeInteger(seq) || seq < 0 || seq > snapshot.lastSeq
        || seq < (replay[0]?.seq ?? snapshot.lastSeq + 1) - 1) return null;
      return structuredClone(replay.filter(event => event.seq > seq));
    }, close};
}
