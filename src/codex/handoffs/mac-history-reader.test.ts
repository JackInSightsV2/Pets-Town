import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { createMacHistoryReader } from './mac-history-reader.js';

type Rpc = { id?: number; method: string; params?: Record<string, unknown> };
const userAgent = 'codex-tui/0.166.0 (Mac OS 27.0.1; arm64) synthetic-test/1.0';
async function daemon(t: TestContext, read: (message: Rpc, socket: WebSocket) => void, initialize: unknown = {
  userAgent, platformOs: 'macos', platformFamily: 'unix', codexHome: '/synthetic',
}) {
  const dir = await mkdtemp('/tmp/petstown-history-');
  const socketPath = join(dir, 'daemon.sock');
  const http = createServer();
  const ws = new WebSocketServer({ server: http });
  const calls: Rpc[] = [];
  ws.on('connection', socket => {
    socket.on('error', () => {});
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString()) as Rpc;
      calls.push(message);
      if (message.method === 'initialize') socket.send(JSON.stringify({ id: message.id, result: initialize }));
      else if (message.method !== 'initialized') read(message, socket);
    });
  });
  await new Promise<void>(done => http.listen(socketPath, done));
  t.after(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(done => ws.close(() => done()));
    await new Promise<void>(done => http.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  });
  return { socketPath, calls, ws };
}

test('synthetic Unix reader only reads current scoped IDs and exposes the exact verified initialize runtime', async t => {
  const allowed = new Set(['scoped']);
  let revoke = false;
  const server = await daemon(t, (message, socket) => {
    assert.equal(message.method, 'thread/read');
    assert.deepEqual(message.params, { threadId: message.params?.threadId, includeTurns: true });
    if (revoke) allowed.clear();
    socket.send(JSON.stringify({ id: message.id, result: { thread: { id: message.params?.threadId, turns: [] } } }));
  });
  const reader = await createMacHistoryReader({ socketPath: server.socketPath, isAllowed: id => allowed.has(id) });
  t.after(() => reader.close());
  assert.equal(reader.userAgent, userAgent);
  assert.equal(reader.version, '0.166.0');
  const generation = reader.generation;
  await assert.rejects(reader.read('outside'), /outside the current allowed scope/);
  assert.deepEqual(await reader.read('scoped'), { thread: { id: 'scoped', turns: [] } });
  allowed.add('late-scoped');
  await reader.read('late-scoped');
  revoke = true;
  await assert.rejects(reader.read('scoped'), /no longer in the allowed scope/);
  assert.deepEqual(server.calls.map(call => call.method), ['initialize', 'initialized', 'thread/read', 'thread/read', 'thread/read']);
  assert.ok(server.calls.filter(call => call.method === 'thread/read').every(call => call.params?.threadId !== 'outside'));
  reader.close();
  assert.notEqual(reader.generation, generation);
});

test('synthetic reader fails closed for missing, different, prerelease or non-Mac runtime versions', async t => {
  for (const initialize of [
    { userAgent: 'codex-tui/0.167.0', platformOs: 'macos', platformFamily: 'unix' },
    { userAgent: 'codex-tui/0.166.0-dev', platformOs: 'macos', platformFamily: 'unix' },
    { platformOs: 'macos', platformFamily: 'unix' },
    { userAgent, platformOs: 'linux', platformFamily: 'unix' },
  ]) {
    const server = await daemon(t, () => assert.fail('Unverified runtime must never receive history reads'), initialize);
    await assert.rejects(createMacHistoryReader({ socketPath: server.socketPath, isAllowed: () => true }), /Unsupported history runtime/);
    assert.deepEqual(server.calls.map(call => call.method), ['initialize']);
  }
});

test('synthetic reader sanitizes errors and invalidates its generation on timeout, oversized payload or mismatched thread', async t => {
  let mode = 'error';
  const server = await daemon(t, (message, socket) => {
    if (mode === 'error') socket.send(JSON.stringify({ id: message.id, error: { code: -32000, message: 'SYNTHETIC_PRIVATE_CONTENT' } }));
    if (mode === 'oversized') socket.send(JSON.stringify({ id: message.id, result: { privateText: 'x'.repeat(4096) } }));
    if (mode === 'mismatch') socket.send(JSON.stringify({ id: message.id, result: { thread: { id: 'another-thread', turns: [] } } }));
  });
  for (const next of ['error', 'timeout', 'oversized', 'mismatch']) {
    mode = next;
    const reader = await createMacHistoryReader({ socketPath: server.socketPath, isAllowed: id => id === 'scoped', timeoutMs: 100, maxPayloadBytes: 1024 });
    const generation = reader.generation;
    try {
      await assert.rejects(reader.read('scoped'), error => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('SYNTHETIC_PRIVATE_CONTENT'));
        assert.match(error.message, /History request rejected|History read timed out|History connection failed|Invalid correlated history response/);
        return true;
      });
      if (next !== 'error') assert.notEqual(reader.generation, generation);
    } finally { reader.close(); }
  }
});
