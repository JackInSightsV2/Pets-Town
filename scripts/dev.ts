import { spawn, type ChildProcess } from 'node:child_process';
import { readOptions, startBridge } from '../src/server/main.js';

// One parent owns the bridge and Vite child; failures shut down both.
async function main() {
  const options=readOptions();
  if(options.port!==4317)throw new Error('Combined dev uses the Vite proxy on port 4317. Run the bridge separately and configure Vite to use a custom port.');
  const bridge=await startBridge(options);
  let vite:ChildProcess|undefined;let stopping=false;
  const stop=async(code=0)=>{if(stopping)return;stopping=true;vite?.kill('SIGTERM');await bridge.close();process.exitCode=code;};
  try {
    vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit'});
    vite.once('error',error=>{console.error(error);void stop(1);});
    vite.once('exit',code=>{void stop(code??0);});
    process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
    console.log(`Bridge ready: ${bridge.url}. Development browser URL is printed by Vite.`);
  } catch(error) {await stop(1);throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
