import { open } from 'node:fs/promises';
import type { MetadataReader } from './metadata-adapter.js';
import { canonicalizeCwd } from './observer-normalization.js';

const MAX_INDEX_BYTES = 16 * 1024 * 1024;
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const name = (value: unknown): string | undefined => typeof value === 'string' && value.trim()
  && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined;

/** Only native index names for the requested, source-verified identities are retained. */
export async function readNativeThreadNames(indexPath: string, ids: ReadonlySet<string>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.size) return names;
  const file = await open(indexPath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return names;
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length) return names;
    const latest = new Map<string, { updated: number; name?: string }>();
    const contents = buffer.toString('utf8');
    // A writer may be appending its last line. Never accept an incomplete record.
    for (const line of contents.slice(0, contents.lastIndexOf('\n') + 1).split('\n')) {
      if (!line || line.length > 64 * 1024) continue;
      let row: unknown;
      try { row = JSON.parse(line); } catch { continue; }
      if (!object(row) || typeof row.id !== 'string' || !ids.has(row.id)) continue;
      const title = name(row.thread_name);
      const updated = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN;
      if (!title || !Number.isFinite(updated)) continue;
      const previous = latest.get(row.id);
      if (!previous || updated > previous.updated) latest.set(row.id, { updated, name: title });
      // Contradictory equally current names have no trustworthy ordering.
      else if (updated === previous.updated && title !== previous.name) previous.name = undefined;
    }
    for (const [id, row] of latest) if (row.name) names.set(id, row.name);
    return names;
  } finally { await file.close(); }
}

export interface NativeThreadNameOptions {
  allowedCwds: readonly string[];
  readNames: (ids: ReadonlySet<string>) => Promise<ReadonlyMap<string, string>>;
}

/** Optional native names do not change roster, runtime state, or connection health. */
export function withNativeThreadNames(source: MetadataReader, options: NativeThreadNameOptions): MetadataReader {
  const allowed = new Set(options.allowedCwds.map(canonicalizeCwd).filter(Boolean));
  const scopedIds = new Set<string>();
  let names = new Map<string, string>();
  let attempted = new Set<string>();
  async function lookup(ids: ReadonlySet<string>) {
    for (const id of ids) attempted.add(id);
    try {
      const found = await options.readNames(ids);
      for (const [id, title] of found) if (ids.has(id) && name(title)) names.set(id, title);
    } catch { /* Missing or temporarily unreadable optional metadata must not stop observation. */ }
  }
  return {
    get connected() { return source.connected; },
    get healthMessage() { return source.healthMessage; },
    close() { scopedIds.clear(); names.clear(); attempted.clear(); source.close(); },
    async call(method, params) {
      const result = await source.call(method, params);
      if (method === 'thread/loaded/list' && params.cursor == null) {
        names = new Map(); attempted = new Set();
        if (object(result) && Array.isArray(result.data)) {
          const loaded = new Set(result.data.filter((id): id is string => typeof id === 'string'));
          for (const id of scopedIds) if (!loaded.has(id)) scopedIds.delete(id);
          await lookup(scopedIds);
        }
      }
      if (method !== 'thread/read' || !object(result) || !object(result.thread)) return result;
      const thread = result.thread;
      const id = params.threadId;
      if (typeof id !== 'string' || thread.id !== id || !allowed.has(canonicalizeCwd(thread.cwd))) return result;
      scopedIds.add(id);
      if (!attempted.has(id)) await lookup(new Set([id]));
      const title = names.get(id);
      return title ? { ...result, thread: { ...thread, name: title } } : result;
    },
  };
}

