import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { MetadataRpc } from './metadata-rpc.js';

test('synthetic Unix socket: subscription sends no RPC, isolates consumers, and never receives request bodies', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pt-observer-'));
  const socketPath = join(directory, 'test.sock');
  const server = createServer();
  const wsServer = new WebSocketServer({ server });
  let peer: WebSocket | undefined;
  const methods: string[] = [];
  wsServer.on('connection', socket => {
    peer = socket;
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      methods.push(message.method);
      if (message.method === 'initialize') socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
  });
  await new Promise<void>(done => server.listen(socketPath, done));
  let rpc: MetadataRpc | undefined;
  t.after(async () => {
    rpc?.close();
    for (const client of wsServer.clients) client.terminate();
    await new Promise<void>(done => wsServer.close(() => done()));
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  });
  rpc = await MetadataRpc.connect(socketPath);
  rpc.subscribeNotifications(() => { throw new Error('Synthetic consumer failure'); });
  const delivered = new Promise<unknown>(done => rpc!.subscribeNotifications(done));
  peer!.send(JSON.stringify({ id: 50, method: 'item/tool/requestUserInput', params: { private: 'SYNTHETIC_PRIVATE' } }));
  peer!.send(JSON.stringify({ method: 'item/completed', params: { threadId: 'synthetic-sender', turnId: 'synthetic-turn',
    item: { id: 'synthetic-item', type: 'subAgentActivity', kind: 'interacted', agentThreadId: 'synthetic-recipient', prompt: 'SYNTHETIC_PRIVATE' } } }));
  const value = await delivered;
  assert.ok(!JSON.stringify(value).includes('SYNTHETIC_PRIVATE'));
  await assert.rejects(rpc.call('thread/read', { threadId: 'synthetic-sender', includeTurns: true }));
  await assert.rejects(rpc.call('turn/start' as never, {}));
  assert.ok(methods.every(method => method === 'initialize' || method === 'initialized'));
});
