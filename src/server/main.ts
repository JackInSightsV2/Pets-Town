import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { builtInPets } from '../shared/pets.js';
import { createOfficeServer } from './server.js';
import { createFixtureAdapter } from './fixture.js';
import { createUnsupportedAdapter, type OfficeAdapter } from './adapter.js';

export function readOptions(args=process.argv.slice(2)) {
  const value=(name:string)=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} requires a value`);return args[i+1];};
  const port=Number(value('--port')??process.env.PETSTOWN_PORT??4317);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Port must be between 1 and 65535');
  const adapterModule=value('--adapter')??process.env.PETSTOWN_ADAPTER_MODULE;
  if(args.includes('--fixture')&&adapterModule)throw new Error('Choose --fixture or --adapter, not both');
  return {port,fixture:args.includes('--fixture'),adapterModule,noOpen:args.includes('--no-open')};
}
export async function loadAdapter(options: ReturnType<typeof readOptions>): Promise<OfficeAdapter> {
  if(options.fixture)return createFixtureAdapter();
  if(!options.adapterModule)return createUnsupportedAdapter();
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
  return createOfficeServer({port:options.port,adapter:await loadAdapter(options),distDir:resolve(root,'dist'),officeAssetPath:resolve(root,'assets/office/office-v1.png'),petAssetFiles:await approvedLocalPetFiles(root)});
}
export function installShutdown(bridge: Awaited<ReturnType<typeof startBridge>>) {
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;void bridge.close().then(()=>{process.exitCode=0;}).catch(error=>{console.error(error);process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  startBridge().then(bridge=>{console.log(`PetsTown observation bridge: ${bridge.url}`);installShutdown(bridge);}).catch(error=>{console.error(error);process.exitCode=1;});
}
