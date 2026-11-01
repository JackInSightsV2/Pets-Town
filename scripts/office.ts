import { spawn } from 'node:child_process';
import { readOptions, startBridge, installShutdown } from '../src/server/main.js';

async function openBrowser(url:string) {
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';
  const args=process.platform==='win32'?['/c','start','',url]:[url];
  await new Promise<void>((done,reject)=>{const child=spawn(command,args,{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`Browser opener exited ${code}`)));});
}
async function main() {
  const options=readOptions();
  const url=`http://127.0.0.1:${options.port}`;
  let existing: {service?:string;protocolVersion?:number;source?:string}|undefined;
  try {const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(700)});if(response.ok)existing=await response.json();} catch { /* Startup below distinguishes a free port from a collision. */ }
  if(existing?.service==='petstown-office'&&existing.protocolVersion===1) {
    if(options.adapterModule)throw new Error('A bridge already occupies this port; adapter identity cannot be verified. Stop it yourself or choose another --port to load the requested adapter.');
    if((options.fixture?'fixture':'codex')!==existing.source)throw new Error(`Existing bridge mode is ${existing.source}; use another --port or stop that bridge yourself.`);
    console.log(`Reusing PetsTown bridge ${url}`);
    if(!options.noOpen)await openBrowser(url);
    return;
  }
  let bridge: Awaited<ReturnType<typeof startBridge>>;
  try {bridge=await startBridge(options);} catch(error) {if((error as NodeJS.ErrnoException).code==='EADDRINUSE')throw new Error(`Port ${options.port} is occupied by another service. Choose --port; no process was stopped.`);throw error;}
  try {
    if(!options.noOpen)await openBrowser(bridge.url);
    console.log(`PetsTown ${options.fixture?'FIXTURE development':'observation'} bridge: ${bridge.url}\nKeep this terminal open. Ctrl-C closes this bridge only.`);
    installShutdown(bridge);
  } catch(error) {await bridge.close();throw error;}
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
