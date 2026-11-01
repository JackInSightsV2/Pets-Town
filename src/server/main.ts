import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { canonicalizeCwd } from '../codex/observer-normalization.js';
import { lstat } from 'node:fs/promises';
import { builtInPets } from '../shared/pets.js';
import { createOfficeServer } from './server.js';
import { createFixtureAdapter } from './fixture.js';
import type { OfficeAdapter } from './adapter.js';
import { createAdapter as createPlatformAdapter } from '../codex/platform-adapter.js';

export function readOptions(args=process.argv.slice(2)) {
  const value=(name:string)=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} requires a value`);return args[i+1];};
  const port=Number(value('--port')??process.env.PETSTOWN_PORT??4317);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Port must be between 1 and 65535');
  const adapterModule=value('--adapter')??process.env.PETSTOWN_ADAPTER_MODULE;
  if(args.includes('--fixture')&&adapterModule)throw new Error('Choose --fixture or --adapter, not both');
  return {port,fixture:args.includes('--fixture'),adapterModule,noOpen:args.includes('--no-open')};
}
/** Opaque identity of the built-in observer's exact scope and existing daemon endpoint. */
export function defaultObserverIdentity(): string {
  const paths:unknown=process.env.PETSTOWN_METADATA_CWDS?JSON.parse(process.env.PETSTOWN_METADATA_CWDS):[process.cwd()];
  if(!Array.isArray(paths)||paths.length===0)throw new Error('PETSTOWN_METADATA_CWDS must be a nonempty JSON array of absolute directories.');
  const canonical=paths.map(canonicalizeCwd);
  if(canonical.some(path=>path===null))throw new Error('Observer directories must be absolute.');
  const socket=resolve(process.env.PETSTOWN_METADATA_SOCKET??resolve(process.env.CODEX_HOME??resolve(homedir(),'.codex'),'app-server-control/app-server-control.sock'));
  return createHash('sha256').update(JSON.stringify({kind:'lifecycle-v2',platform:process.platform,cwds:[...new Set(canonical)].sort(),socket,rolloutRoot:process.env.PETSTOWN_ROLLOUT_ROOT??null,rolloutFiles:process.env.PETSTOWN_ROLLOUT_FILES??null})).digest('hex');
}
export async function loadAdapter(options: ReturnType<typeof readOptions>): Promise<OfficeAdapter> {
  if(options.fixture)return createFixtureAdapter();
  if(!options.adapterModule)return createPlatformAdapter();
  const specifier=options.adapterModule.startsWith('.')||options.adapterModule.startsWith('/')?pathToFileURL(resolve(options.adapterModule)).href:options.adapterModule;
  const module=await import(specifier);
  const candidate=module.createAdapter??module.default;
  const adapter=typeof candidate==='function'?await candidate():candidate;
  if(!adapter||typeof adapter.initialSnapshot!=='function'||typeof adapter.subscribe!=='function'||typeof adapter.stop!=='function')throw new Error('Adapter must export createAdapter() or default with initialSnapshot, subscribe and stop');
  return adapter;
}
export async function approvedLocalPetFiles(root=fileURLToPath(new URL('../../',import.meta.url))) {
  const files:Record<string,string>={};
  for(const pet of builtInPets) {
    if(!['codex','dewey','hoots'].includes(pet.assetId))continue;
    const file=resolve(root,'.cache','pets',`${pet.assetId}.webp`);
    try {const info=await lstat(file);if(info.isFile()&&!info.isSymbolicLink())files[pet.assetId]=file;} catch { /* Missing cache retains the approved official CDN URL. */ }
  }
  return files;
}
export async function startBridge(options=readOptions()) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  return createOfficeServer({port:options.port,adapter:await loadAdapter(options),distDir:resolve(root,'dist'),officeAssetPath:resolve(root,'assets/office/office-v1.png'),petAssetFiles:await approvedLocalPetFiles(root),...(!options.fixture&&!options.adapterModule?{launchIdentity:defaultObserverIdentity()}:{})});
}
export function installShutdown(bridge: Awaited<ReturnType<typeof startBridge>>) {
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;void bridge.close().then(()=>{process.exitCode=0;}).catch(error=>{console.error(error);process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  startBridge().then(bridge=>{console.log(`PetsTown observation bridge: ${bridge.url}`);installShutdown(bridge);}).catch(error=>{console.error(error);process.exitCode=1;});
}
