import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// Old empty and custom observers both reported source=codex; that is not reuse identity.
test('default launcher rejects an existing unverified codex bridge without starting an adapter', async (t) => {
  const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({service:'petstown-office',protocolVersion:1,source:'codex'}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise<void>(done=>server.close(()=>done())));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const env={...process.env};delete env.PETSTOWN_ADAPTER_MODULE;
  env.PETSTOWN_METADATA_CWDS='invalid-json-to-prove-adapter-is-not-started';
  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/office.ts','--no-open','--port',String(address.port)],{env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',code=>done({code,output}));
  });
  assert.equal(result.code,1);assert.match(result.output,/observer identity and working-directory scope cannot be verified/);assert.match(result.output,/another --port/);assert.doesNotMatch(result.output,/JSON|Reusing/);
});

test('default launcher reuses matching observer identity and rejects a different identity', async (t) => {
  const {defaultObserverIdentity}=await import('./main.js');
  const identity=defaultObserverIdentity();assert.match(identity,/^[a-f0-9]{64}$/);
  let reportedIdentity=identity;
  const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({service:'petstown-office',protocolVersion:1,source:'codex',launchIdentity:reportedIdentity}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise<void>(done=>server.close(()=>done())));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const env={...process.env};delete env.PETSTOWN_ADAPTER_MODULE;
  const launch=()=>new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/office.ts','--no-open','--port',String(address.port)],{env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',code=>done({code,output}));
  });
  const matching=await launch();assert.equal(matching.code,0);assert.match(matching.output,/Reusing PetsTown bridge/);
  reportedIdentity='0'.repeat(64);
  const mismatch=await launch();assert.equal(mismatch.code,1);assert.match(mismatch.output,/observer identity and working-directory scope cannot be verified/);
});
