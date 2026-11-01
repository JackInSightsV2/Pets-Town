import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { MetadataReader } from './metadata-adapter.js';
import { MetadataRpcError } from './metadata-rpc.js';
import { canonicalizeCwd } from './observer-normalization.js';
import { RolloutActivityBatch } from './activity/rollout-activity.js';

const READ_CHUNK_BYTES = 64 * 1024;
// Bound memory per record while accommodating large normal transcript records.
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_PATHS = 1000;
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => typeof v === 'string' && v.length > 0 ? v : undefined;
type Status = 'unknown' | 'active' | 'idle' | 'systemError';
interface FileState {
  path: string; offset: number; prefix: Buffer; dev: number; ino: number;
  historicalEnd: number; lastSize: number; initial: boolean;
  id?: string; cwd?: string; parent?: string; nickname?: string; agentPath?: string; status: Status; turn?: string;
}

/** Explicit existing rollout files only. No directory discovery, writes or transcript retention. */
export class RolloutReader implements MetadataReader {
  connected = true;
  private readonly files: FileState[];
  private readonly discover?: () => Promise<string[]>;
  private rows = new Map<string, FileState>();
  private quarantined = new Set<FileState>();
  get healthMessage(): string | undefined {
    return this.quarantined.size ? `${this.quarantined.size} rollout file(s) quarantined; some sessions may be missing.` : undefined;
  }

  constructor(paths: readonly string[], discover?: () => Promise<string[]>, private readonly onActivityBatch?: (threadId: string, cwd: string, batch: RolloutActivityBatch) => void) {
    if ((!paths.length && !discover) || paths.length > MAX_PATHS || paths.some(p => !isAbsolute(p) || p.includes('\0')) || new Set(paths).size !== paths.length)
      throw new Error('Provide a bounded list of distinct absolute rollout paths.');
    this.discover = discover;
    this.files = paths.map(path => ({ path, offset: 0, prefix: Buffer.alloc(0), dev: 0, ino: 0,
      historicalEnd: 0, lastSize: 0, initial: true, status: 'unknown' }));
  }

  close(): void { this.connected = false; this.rows.clear(); }

  /** True only after the latest complete refresh retained this scoped identity. */
  hasVerifiedThread(threadId: string, allowedCwds: ReadonlySet<string | null>): boolean {
    const file = this.rows.get(threadId);
    return this.connected && !!file?.cwd && allowedCwds.has(canonicalizeCwd(file.cwd));
  }

  async call(method: 'thread/loaded/list' | 'thread/read' | 'thread/goal/get', params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) throw new Error('Reader is closed.');
    if (method === 'thread/goal/get') throw new MetadataRpcError(-32601);
    if (method === 'thread/loaded/list') {
      if (params.cursor != null) throw new Error('Pagination is not supported.');
      await this.refresh();
      return { data: [...this.rows.keys()], nextCursor: null };
    }
    if (method !== 'thread/read' || params.includeTurns !== false || typeof params.threadId !== 'string')
      throw new Error('Only metadata reads are supported.');
    const row = this.rows.get(params.threadId);
    if (!row || !row.id || !row.cwd) throw new Error('Thread not found.');
    return { thread: { id: row.id, cwd: row.cwd, parentThreadId: row.parent ?? null, agentNickname: row.nickname ?? null, agentPath: row.agentPath ?? null,
      status: row.status === 'active' ? { type: 'active', activeFlags: [] } : { type: row.status } } };
  }

  private async refresh(): Promise<void> {
    if (this.discover) {
      const paths = await this.discover();
      if (paths.length > MAX_PATHS || paths.some(p => !isAbsolute(p) || p.includes('\0')) || new Set(paths).size !== paths.length)
        throw new Error('Invalid discovered rollout paths.');
      const known = new Set(this.files.map(file => file.path));
      const additions = paths.filter(path => !known.has(path));
      if (this.files.length + additions.length > MAX_PATHS) throw new Error('Cumulative rollout discovery limit exceeded; restart the observer.');
      for (const path of additions) this.files.push({ path, offset: 0, prefix: Buffer.alloc(0), dev: 0, ino: 0,
        historicalEnd: 0, lastSize: 0, initial: true, status: 'unknown' });
    }
    const batches = new Map<FileState, RolloutActivityBatch>();
    const budget = { count: 0, limit: 10_000 };
    for (const file of this.files) {
      if (this.quarantined.has(file)) continue;
      const batch = new RolloutActivityBatch(10_000, budget);
      try { await this.readFile(file, batch); batches.set(file, batch); } catch { this.quarantined.add(file); }
    }
    const identities = new Map<string, FileState[]>();
    for (const file of this.files) if (file.id && file.cwd) {
      const group = identities.get(file.id) ?? [];
      group.push(file); identities.set(file.id, group);
    }
    const rows = new Map<string, FileState>();
    for (const [id, group] of identities) {
      if (group.length !== 1) { for (const file of group) this.quarantined.add(file); }
      else if (!this.quarantined.has(group[0])) rows.set(id, group[0]);
    }
    this.rows = rows;
    if (this.onActivityBatch) for (const [id, file] of rows) {
      const batch = batches.get(file);
      if (batch && file.cwd) this.onActivityBatch(id, file.cwd, batch);
    }
  }

  private async readFile(file: FileState, batch: RolloutActivityBatch): Promise<void> {
    const handle = await open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < file.lastSize) throw new Error('Rollout changed.');
      if (!file.initial) {
        if ((file.ino && stat.ino && (file.ino !== stat.ino || file.dev !== stat.dev))) throw new Error('Rollout replaced.');
        const check = Buffer.alloc(file.prefix.length);
        const read = await handle.read(check, 0, check.length, 0);
        if (read.bytesRead !== check.length || !check.equals(file.prefix)) throw new Error('Rollout replaced.');
      }
      if (file.initial) {
        file.dev = stat.dev; file.ino = stat.ino; file.historicalEnd = stat.size;
        const prefix = Buffer.alloc(Math.min(256, stat.size));
        const read = await handle.read(prefix, 0, prefix.length, 0);
        if (read.bytesRead !== prefix.length) throw new Error('Short rollout read.');
        file.prefix = prefix;
      }
      // Only complete lines advance the durable offset. An incomplete tail is
      // reread next poll so transcript bytes are never retained between polls.
      let position = file.offset;
      let lineStart = position;
      let pieces: Buffer[] = [];
      let lineLength = 0;
      while (position < stat.size) {
        const length = Math.min(READ_CHUNK_BYTES, stat.size - position);
        const data = Buffer.alloc(length);
        const read = await handle.read(data, 0, length, position);
        if (read.bytesRead !== length) throw new Error('Short rollout read.');
        let start = 0;
        for (let i = 0; i < data.length; i++) if (data[i] === 10) {
          const part = data.subarray(start, i);
          lineLength += part.length;
          if (lineLength > MAX_LINE_BYTES) throw new Error('Oversized rollout line.');
          pieces.push(part);
          this.consume(file, Buffer.concat(pieces, lineLength), lineStart < file.historicalEnd, batch);
          file.offset = position + i + 1;
          lineStart = file.offset;
          pieces = []; lineLength = 0; start = i + 1;
        }
        const tail = data.subarray(start);
        lineLength += tail.length;
        if (lineLength > MAX_LINE_BYTES) throw new Error('Oversized rollout line.');
        if (tail.length) pieces.push(tail);
        position += length;
      }
      file.lastSize = stat.size;
      file.initial = false;
    } finally { await handle.close(); }
  }

  private consume(file: FileState, line: Buffer, historical: boolean, batch: RolloutActivityBatch): void {
    let record: unknown;
    try { record = JSON.parse(line.toString('utf8')); } catch { throw new Error('Invalid rollout line.'); }
    if (!obj(record) || !obj(record.payload)) return;
    const payload = record.payload;
    if (this.onActivityBatch) batch.add(file.id, record, historical);
    if (record.type === 'session_meta') {
      const id = str(payload.id), cwd = str(payload.cwd);
      if (!id || !cwd || (file.id && (file.id !== id || canonicalizeCwd(file.cwd) !== canonicalizeCwd(cwd) || file.parent !== str(payload.parent_thread_id)))) throw new Error('Invalid session metadata.');
      file.id = id; file.cwd = cwd; file.parent = str(payload.parent_thread_id); file.nickname = str(payload.agent_nickname); file.agentPath = str(payload.agent_path);
    } else if (record.type === 'event_msg') {
      const turn = str(payload.turn_id);
      switch (payload.type) {
        case 'task_started': case 'turn_started':
          file.turn = turn; file.status = !turn || historical ? 'unknown' : 'active'; break;
        case 'task_complete': case 'turn_complete':
          if (!turn || (file.turn && file.turn !== turn)) { file.status = 'unknown'; break; }
          file.turn = undefined; file.status = historical ? 'unknown' : payload.error != null ? 'systemError' : 'idle'; break;
        case 'turn_aborted':
          file.turn = undefined; file.status = 'unknown'; break;
      }
    }
  }
}
