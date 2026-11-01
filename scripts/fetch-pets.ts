import { spawn } from 'node:child_process';
import { mkdir, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { builtInPets } from '../src/shared/pets.js';

// curl uses the system certificate store; never bypass certificate verification.
async function main() {
  const directory=fileURLToPath(new URL('../.cache/pets/',import.meta.url));
  await mkdir(directory,{recursive:true});
  for(const pet of builtInPets) {
    if(!['codex','dewey','hoots'].includes(pet.assetId))throw new Error(`Unrecognized built-in asset ${pet.assetId}`);
    const url=new URL(pet.imageUrl);
    if(url.protocol!=='https:'||url.hostname!=='cdn.openai.com')throw new Error('Pet manifest must use the official HTTPS CDN');
    const target=resolve(directory,`${pet.assetId}.webp`), temporary=target+`.${process.pid}.download`;
    try {
      await new Promise<void>((done,reject)=>{const child=spawn('curl',['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','90','--output',temporary,pet.imageUrl],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`curl exited ${code}`)));});
      const bytes=await readFile(temporary);
      if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw new Error('Download is not a WebP image');
      await rename(temporary,target);console.log(`Cached official ${pet.name} asset`);
    } catch(error) {await rm(temporary,{force:true});throw new Error(`Unable to cache ${pet.name}. Check network/certificate setup and system curl availability. ${error instanceof Error?error.message:String(error)}`);}
  }
  await writeFile(resolve(directory,'README.md'),'# Official pet asset cache\n\nDownloaded directly from the official URLs in src/shared/pets.ts using HTTPS certificate verification. Local cache only; do not commit or redistribute this directory. The bridge serves only the known codex.webp, dewey.webp and hoots.webp files. Recreate with npm run pets:fetch.\n');
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
