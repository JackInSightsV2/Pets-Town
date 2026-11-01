import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import type { VerifiedHistoryReader } from './history-adapter.js';

export interface MacHistoryReader extends VerifiedHistoryReader {
  readonly userAgent: string;
  readonly version: '0.166.0';
}
export interface MacHistoryReaderOptions {
  /** Must check the currently observed, scoped roster. Never authorize arbitrary browser IDs. */
  isAllowed(threadId: string): boolean;
  socketPath?: string;
  timeoutMs?: number;
  maxPayloadBytes?: number;
}
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * An independent read-only connection to an existing Mac daemon. No discovery,
 * execution control, replies or subscriptions; only initialize, initialized,
 * and explicitly authorized thread/read(includeTurns:true). Do not log results.
 * A failed connection is terminal. Create a new reader to retry and rebaseline.
 */
export async function createMacHistoryReader(options: MacHistoryReaderOptions): Promise<MacHistoryReader> {
  const socketPath = options.socketPath ?? process.env.PETSTOWN_METADATA_SOCKET
    ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxPayload = options.maxPayloadBytes ?? 20 * 1024 * 1024;
  if (process.platform === 'win32' || !socketPath.startsWith('/') || /[:\0?#]/.test(socketPath)) throw new Error('An existing Unix history socket is required.');
  if (typeof options.isAllowed !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000
    || !Number.isSafeInteger(maxPayload) || maxPayload < 1024 || maxPayload > 20 * 1024 * 1024) throw new Error('Invalid bounded history-reader options.');
  let socket: WebSocket;
  try { socket = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: timeoutMs, maxPayload }); }
  catch { throw new Error('Could not open the existing history socket.'); }
  let generation = randomUUID();
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function close(message = 'History reader closed.') {
    if (closed) return;
    closed = true;
    generation = randomUUID();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)); }
    pending.clear();
    socket.terminate();
  }
  socket.on('error', () => close('History connection failed.'));
  socket.on('close', () => close('History connection closed.'));
  socket.on('message', bytes => {
    let message: unknown;
    try { message = JSON.parse(bytes.toString()); } catch { close('Invalid history response.'); return; }
    // Unsolicited requests/notifications are not this reader's responsibility.
    if (!object(message) || typeof message.id !== 'number' || !('result' in message || 'error' in message)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if ('error' in message) {
      const code = object(message.error) && typeof message.error.code === 'number' ? message.error.code : 'unknown';
      waiter.reject(new Error(`History request rejected (${code}).`));
    } else waiter.resolve(message.result);
  });
  function call(method: 'initialize' | 'thread/read', params: Row): Promise<unknown> {
    if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('History reader is not connected.'));
    if (pending.size >= 8) return Promise.reject(new Error('History reader concurrent request limit reached.'));
    return new Promise((done, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => close('History read timed out.'), timeoutMs);
      pending.set(id, { resolve: done, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }), error => { if (error) close('History request could not be sent.'); });
      } catch { close('History request could not be sent.'); }
    });
  }
  function allowed(threadId: string): boolean {
    if (typeof threadId !== 'string' || !threadId.trim()) return false;
    try { return options.isAllowed(threadId) === true; } catch { return false; }
  }
  try {
    await new Promise<void>((done, reject) => {
      const cleanup = () => { socket.off('open', opened); socket.off('error', failed); socket.off('close', failed); };
      const opened = () => { cleanup(); done(); };
      const failed = () => { cleanup(); reject(new Error('Could not connect to the existing history socket.')); };
      socket.once('open', opened); socket.once('error', failed); socket.once('close', failed);
    });
    const initialized = await call('initialize', { clientInfo: { name: 'petstown-mac-history-reader', version: '0.1.0' },
      capabilities: { experimentalApi: true } });
    if (!object(initialized) || initialized.platformOs !== 'macos' || initialized.platformFamily !== 'unix'
      || typeof initialized.userAgent !== 'string' || initialized.userAgent.length > 2048
      || !/^codex(?:-[a-z0-9_-]+)?\/0\.166\.0(?:\s|$)/i.test(initialized.userAgent)) {
      throw new Error('Unsupported history runtime; expected macOS Codex 0.166.0.');
    }
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => { close('History initialization timed out.'); reject(new Error('History initialization timed out.')); }, timeoutMs);
      try {
        socket.send(JSON.stringify({ method: 'initialized' }), error => {
          clearTimeout(timer);
          if (error) reject(new Error('History initialization could not be sent.')); else done();
        });
      } catch { clearTimeout(timer); reject(new Error('History initialization could not be sent.')); }
    });
    const userAgent = initialized.userAgent;
    return {
      get generation() { return generation; }, userAgent, version: '0.166.0',
      async read(threadId) {
        if (!allowed(threadId)) throw new Error('History thread is outside the current allowed scope.');
        const response = await call('thread/read', { threadId, includeTurns: true });
        if (!allowed(threadId)) throw new Error('History thread is no longer in the allowed scope.');
        if (!object(response) || !object(response.thread) || response.thread.id !== threadId || !Array.isArray(response.thread.turns)) {
          close('Invalid correlated history response.');
          throw new Error('Invalid correlated history response.');
        }
        return response;
      },
      close: () => close(),
    };
  } catch (error) {
    close();
    throw error;
  }
}
