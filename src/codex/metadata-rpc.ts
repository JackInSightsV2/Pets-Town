/** Extracted from Jack's manual metadata probe; only reads an existing daemon. */
import WebSocket from 'ws';
type RpcMethod = 'initialize' | 'thread/loaded/list' | 'thread/read';
const READ_ONLY_METHODS = new Set<RpcMethod>(['initialize', 'thread/loaded/list', 'thread/read']);
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;

export class MetadataRpc {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private socket: WebSocket) {
    socket.on('message', bytes => {
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      // Ignore notifications and unsolicited server requests without retaining their contents.
      if (!object(message) || typeof message.id !== 'number' || !('result' in message || 'error' in message)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if ('error' in message) {
        const code = object(message.error) && typeof message.error.code === 'number' ? message.error.code : 'unknown';
        pending.reject(new Error(`Codex metadata request rejected (${code}).`));
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
  get connected() { return this.socket.readyState === WebSocket.OPEN; }
  call(method: RpcMethod, params: JsonObject): Promise<unknown> {
    if (method === 'thread/read' && (params.includeTurns !== false || typeof params.threadId !== 'string' || Object.keys(params).some(key => key !== 'threadId' && key !== 'includeTurns'))) return Promise.reject(new Error('Metadata reads require includeTurns:false.'));
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
  close() { this.rejectPending(new Error('Metadata observer stopped.')); this.socket.terminate(); }
}
