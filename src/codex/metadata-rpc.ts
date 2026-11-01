/** Extracted from Jack's manual metadata probe; only reads an existing daemon. */
import WebSocket from 'ws';
import { selectObserverNotification, type ObserverNotification } from './observer-notifications.js';
type RpcMethod = 'initialize' | 'thread/loaded/list' | 'thread/read' | 'thread/goal/get';
const READ_ONLY_METHODS = new Set<RpcMethod>(['initialize', 'thread/loaded/list', 'thread/read', 'thread/goal/get']);
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;

/** Preserve protocol classification without retaining server error text. */
export class MetadataRpcError extends Error {
  constructor(readonly code: number | 'unknown') {
    super(`Codex metadata request rejected (${code}).`);
  }
}

export class MetadataRpc {
  private nextId = 0;
  private nativeListeners = new Set<(notification: ObserverNotification) => void>();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private socket: WebSocket) {
    socket.on('message', bytes => {
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      const notification = selectObserverNotification(message);
      if (notification) {
        for (const listener of [...this.nativeListeners]) { try { listener(structuredClone(notification)); } catch { /* Consumer isolation. */ } }
        return;
      }
      // Ignore unrecognized notifications and all unsolicited server requests.
      if (!object(message) || typeof message.id !== 'number' || !('result' in message || 'error' in message)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if ('error' in message) {
        const code = object(message.error) && typeof message.error.code === 'number' ? message.error.code : 'unknown';
        pending.reject(new MetadataRpcError(code));
      } else pending.resolve(message.result);
    });
    const disconnected = () => this.rejectPending(new Error('Codex metadata socket disconnected.'));
    socket.on('error', disconnected);
    socket.on('close', disconnected);
  }
  static async connect(socketPath: string): Promise<MetadataRpc> {
    if (process.platform === 'win32') throw new Error('This transport requires an existing Unix daemon socket.');
    if (!socketPath.startsWith('/') || socketPath.includes(':')) throw new Error('Invalid Unix metadata socket path.');
    // ws+unix performs the HTTP Upgrade required by the daemon control socket.
    const socket = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: 5000, maxPayload: 20 * 1024 * 1024 });
    const rpc = new MetadataRpc(socket);
    try {
      await new Promise<void>((done, reject) => {
        socket.once('open', done);
        socket.once('error', () => reject(new Error('Could not connect to the existing Codex metadata socket.')));
      });
      await rpc.call('initialize', { clientInfo: { name: 'petstown-manual-metadata-observer', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      socket.send(JSON.stringify({ method: 'initialized' }));
      return rpc;
    } catch (error) { rpc.close(); throw error; }
  }
  /** Passive only: subscribing sends no RPC and does not resume or attach a thread. Delivery must be verified separately. */
  subscribeNotifications(listener: (notification: ObserverNotification) => void): () => void {
    this.nativeListeners.add(listener);
    return () => { this.nativeListeners.delete(listener); };
  }
  get connected() { return this.socket.readyState === WebSocket.OPEN; }
  call(method: RpcMethod, params: JsonObject): Promise<unknown> {
    if (method === 'thread/read' && (params.includeTurns !== false || typeof params.threadId !== 'string' || Object.keys(params).some(key => key !== 'threadId' && key !== 'includeTurns'))) return Promise.reject(new Error('Metadata reads require includeTurns:false.'));
    if (method === 'thread/goal/get' && (!text(params.threadId) || Object.keys(params).some(key => key !== 'threadId'))) return Promise.reject(new Error('Goal reads require only a threadId.'));
    if (!READ_ONLY_METHODS.has(method)) return Promise.reject(new Error('Method outside the read-only allowlist.'));
    if (!this.connected) return Promise.reject(new Error('Codex metadata socket is not connected.'));
    return new Promise((done, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} metadata request timed out.`)); }, 5000);
      this.pending.set(id, { resolve: done, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Could not send Codex metadata request.')); }
      });
    });
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close() { this.nativeListeners.clear(); this.rejectPending(new Error('Metadata observer stopped.')); this.socket.terminate(); }
}
