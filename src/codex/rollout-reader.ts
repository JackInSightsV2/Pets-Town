import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { MetadataReader } from './metadata-adapter.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 256 * 1024;
const MAX_PATHS = 1000;
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => typeof v === 'string' && v.length > 0 ? v : undefined;
type Status = 'unknown' | 'active' | 'idle' | 'systemError';
interface FileState {
  path: string; offset: number; prefix: Buffer; dev: number; ino: number;
  historicalEnd: number; lastSize: number; initial: boolean;
  id?: string; cwd?: string; parent?: string; status: Status; turn?: string;
}

/** Explicit existing rollout files only. No directory discovery, writes or transcript retention. */
export class RolloutReader implements MetadataReader {
  connected = true;
  private readonly files: FileState[];
  private rows = new Map<string, FileState>();

  constructor(paths: readonly string[]) {
    if (!paths.length || paths.length > MAX_PATHS || paths.some(p => !isAbsolute(p) || p.includes('\0')) || new Set(paths).size !== paths.length)
      throw new Error('Provide a bounded list of distinct absolute rollout paths.');
    this.files = paths.map(path => ({ path, offset: 0, prefix: Buffer.alloc(0), dev: 0, ino: 0,
      historicalEnd: 0, lastSize: 0, initial: true, status: 'unknown' }));
  }

  close(): void { this.connected = false; this.rows.clear(); }

  async call(method: 'thread/loaded/list' | 'thread/read', params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) throw new Error('Reader is closed.');
    if (method === 'thread/loaded/list') {
      if (params.cursor != null) throw new Error('Pagination is not supported.');
      await this.refresh();
      return { data: [...this.rows.keys()], nextCursor: null };
    }
    if (method !== 'thread/read' || params.includeTurns !== false || typeof params.threadId !== 'string')
      throw new Error('Only metadata reads are supported.');
    const row = this.rows.get(params.threadId);
    if (!row || !row.id || !row.cwd) throw new Error('Thread not found.');
    return { thread: { id: row.id, cwd: row.cwd, parentThreadId: row.parent ?? null,
      status: row.status === 'active' ? { type: 'active', activeFlags: [] } : { type: row.status } } };
  }

  private async refresh(): Promise<void> {
    try {
      for (const file of this.files) await this.readFile(file);
      const rows = new Map<string, FileState>();
      for (const file of this.files) if (file.id && file.cwd) {
        if (rows.has(file.id)) throw new Error('Duplicate rollout identity.');
        rows.set(file.id, file);
      }
      this.rows = rows;
    } catch {
      this.connected = false;
      this.rows.clear();
      throw new Error('Could not safely read rollout metadata.');
    }
  }

  private async readFile(file: FileState): Promise<void> {
    const handle = await open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size < file.lastSize) throw new Error('Rollout changed.');
      if (!file.initial) {
        if ((file.ino && stat.ino && (file.ino !== stat.ino || file.dev !== stat.dev))) throw new Error('Rollout replaced.');
        const check = Buffer.alloc(file.prefix.length);
        const read = await handle.read(check, 0, check.length, 0);
        if (read.bytesRead !== check.length || !check.equals(file.prefix)) throw new Error('Rollout replaced.');
      }
      const length = stat.size - file.offset;
      const data = Buffer.alloc(length);
      const read = await handle.read(data, 0, length, file.offset);
      if (read.bytesRead !== length) throw new Error('Short rollout read.');
      if (file.initial) {
        file.dev = stat.dev; file.ino = stat.ino; file.historicalEnd = stat.size;
        file.prefix = Buffer.from(data.subarray(0, Math.min(256, data.length)));
      }
      const combined = data;
      let start = 0;
      for (let i = 0; i < combined.length; i++) if (combined[i] === 10) {
        if (i - start > MAX_LINE_BYTES) throw new Error('Oversized rollout line.');
        this.consume(file, combined.subarray(start, i), file.offset + start < file.historicalEnd);
        start = i + 1;
      }
      if (combined.length - start > MAX_LINE_BYTES) throw new Error('Oversized rollout line.');
      // Re-read an incomplete tail next time; retain no partial transcript bytes.
      file.offset += start;
      file.lastSize = stat.size;
      file.initial = false;
    } finally { await handle.close(); }
  }

  private consume(file: FileState, line: Buffer, historical: boolean): void {
    let record: unknown;
    try { record = JSON.parse(line.toString('utf8')); } catch { throw new Error('Invalid rollout line.'); }
    if (!obj(record) || !obj(record.payload)) return;
    const payload = record.payload;
    if (record.type === 'session_meta') {
      const id = str(payload.id), cwd = str(payload.cwd);
      if (!id || !cwd || (file.id && file.id !== id)) throw new Error('Invalid session metadata.');
      file.id = id; file.cwd = cwd; file.parent = str(payload.parent_thread_id);
    } else if (record.type === 'event_msg') {
      const turn = str(payload.turn_id);
      switch (payload.type) {
        case 'task_started': case 'turn_started':
          file.turn = turn; file.status = !turn || historical ? 'unknown' : 'active'; break;
        case 'task_complete': case 'turn_complete':
          if (!turn || (file.turn && file.turn !== turn)) { file.status = 'unknown'; break; }
          file.turn = undefined; file.status = payload.error != null ? 'systemError' : 'idle'; break;
        case 'turn_aborted':
          file.turn = undefined; file.status = 'unknown'; break;
      }
    }
  }
}
