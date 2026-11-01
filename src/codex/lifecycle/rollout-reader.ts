import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { canonicalizeCwd } from '../observer-normalization.js';
import type { TurnLifecycleObservation } from '../../shared/turn-lifecycle.js';
import { createRolloutLifecycleProjector, projectRolloutLifecycleRecord,
  type ProjectedRolloutLifecycleRecord, type RolloutLifecycleProjector } from './rollout-projector.js';

const MAX_PATHS = 1000;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_RECORDS_PER_SCAN = 10_000;
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value;
const ordinal = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sourceTime = (value: unknown): number | null => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

interface Header {
  id: string;
  cwd: string;
  version: string;
  boundary: number | null;
  owned: boolean;
  fingerprint: string;
}
interface FileState {
  path: string;
  offset: number;
  prefix: Buffer;
  dev: number;
  ino: number;
  lastSize: number;
  historicalEnd: number;
  initial: boolean;
  discoveredLater: boolean;
  header: Header | null;
  projector: RolloutLifecycleProjector | null;
  lastOwnedOrdinal: number | null;
}
interface StagedFile { state: FileState; observations: TurnLifecycleObservation[]; firstRead: boolean }
export interface RolloutLifecycleReaderOptions {
  paths: readonly string[];
  discover?: () => Promise<string[]>;
  allowedCwds: readonly string[];
  sourceNamespace: string;
  now?: () => string;
  /** Exact audited native rollout versions, never the unrelated PATH CLI version. */
  sourceVersions?: readonly string[];
}
export interface RolloutLifecycleScan {
  observations: TurnLifecycleObservation[];
  latestTurns: TurnLifecycleObservation[];
  quarantined: number;
}

/**
 * Independent passive lifecycle reader. Reads complete records in file order,
 * stages only fixed structural projections, and commits after file/identity checks.
 * No transcript, error message or source path is returned, logged or persisted.
 */
export class RolloutLifecycleReader {
  private readonly files = new Map<string, FileState>();
  private readonly quarantined = new Set<string>();
  private readonly identityClaims = new Map<string, Set<string>>();
  private readonly allowed: Set<string>;
  private readonly versions: Set<string>;
  private readonly now: () => string;
  private readonly cutover: number;
  private bootstrapped = false;
  private closed = false;
  private scanning = false;

  constructor(private readonly options: RolloutLifecycleReaderOptions) {
    this.allowed = new Set(options.allowedCwds.map(canonicalizeCwd).filter((cwd): cwd is string => cwd !== null));
    if (!this.allowed.size || this.allowed.size !== new Set(options.allowedCwds.map(canonicalizeCwd)).size || !identity(options.sourceNamespace)) throw new Error('Invalid lifecycle scope.');
    this.versions = new Set(options.sourceVersions ?? ['0.166.0-alpha.5.1', '0.166.0']);
    if (!this.versions.size || [...this.versions].some(version => !identity(version))) throw new Error('Invalid lifecycle source versions.');
    this.now = options.now ?? (() => new Date().toISOString());
    this.cutover = sourceTime(this.now()) ?? NaN;
    if (!Number.isFinite(this.cutover)) throw new Error('Invalid lifecycle clock.');
    this.addPaths(options.paths, false);
    if (!this.files.size && !options.discover) throw new Error('Lifecycle reader needs explicit files or bounded discovery.');
  }

  close(): void { this.closed = true; this.files.clear(); }

  async scan(): Promise<RolloutLifecycleScan> {
    if (this.closed) return { observations: [], latestTurns: [], quarantined: this.quarantined.size };
    if (this.scanning) throw new Error('Lifecycle scans must not overlap.');
    this.scanning = true;
    try {
      if (this.options.discover) this.addPaths(await this.options.discover(), this.bootstrapped);
      const observedAt = this.now();
      if (sourceTime(observedAt) === null) throw new Error('Invalid lifecycle clock.');
      const budget = { count: 0 };
      const staged = new Map<string, StagedFile>();
      for (const [key, file] of this.files) {
        if (this.closed) return { observations: [], latestTurns: [], quarantined: this.quarantined.size };
        if (this.quarantined.has(key)) continue;
        try { staged.set(key, await this.readFile(file, budget, observedAt)); }
        catch { this.quarantined.add(key); }
      }
      // Compare all known identities, including quarantined files. A duplicate
      // cannot release staged events from either claimant.
      const identities = new Map<string, string[]>();
      for (const [key, original] of this.files) {
        const header = staged.get(key)?.state.header ?? original.header;
        const claims = new Set(this.identityClaims.get(key));
        if (header) claims.add(header.id);
        for (const id of claims) identities.set(id, [...(identities.get(id) ?? []), key]);
      }
      for (const keys of identities.values()) if (keys.length > 1) keys.forEach(key => this.quarantined.add(key));
      const observations: TurnLifecycleObservation[] = [], latestTurns: TurnLifecycleObservation[] = [];
      for (const [key, stage] of staged) {
        if (this.quarantined.has(key) || this.closed) continue;
        const file = stage.state;
        this.files.set(key, file);
        if (!file.projector) continue;
        if (stage.firstRead && file.discoveredLater) {
          const start = file.projector.latestStart();
          const startedMs = start?.startedAt === null || start?.startedAt === undefined ? null : start.startedAt * 1000;
          // Writer timestamps may be new for copied history. Only a source start
          // after this reader began can qualify, and ownership was filtered first.
          if (startedMs !== null && startedMs >= this.cutover && startedMs <= Date.parse(observedAt)) {
            const promoted = file.projector.confirmLiveStart({ observedAt });
            if (promoted.kind === 'observed') stage.observations = [promoted.observation];
          }
        }
        const latest = file.projector.latest({ observedAt });
        if (latest.kind === 'observed') latestTurns.push(latest.observation);
        if (!this.bootstrapped) continue;
        if (stage.firstRead) {
          const fresh = stage.observations.find(row => row.delivery === 'live' && row.status === 'started');
          if (fresh) observations.push(fresh);
          else if (latest.kind === 'observed') observations.push(latest.observation);
        } else observations.push(...stage.observations);
      }
      this.bootstrapped = true;
      return { observations, latestTurns, quarantined: this.quarantined.size };
    } finally { this.scanning = false; }
  }

  private addPaths(paths: readonly string[], discoveredLater: boolean) {
    if (!Array.isArray(paths) || paths.length > MAX_PATHS) throw new Error('Lifecycle discovery exceeded its bound.');
    const additions = new Map<string, string>();
    for (const path of paths) {
      if (!identity(path) || !isAbsolute(path) || path.includes('\0')) throw new Error('Invalid lifecycle file selection.');
      const key = canonicalizeCwd(path)!;
      if (additions.has(key)) throw new Error('Duplicate lifecycle file selection.');
      additions.set(key, path);
    }
    if (new Set([...this.files.keys(), ...additions.keys()]).size > MAX_PATHS) throw new Error('Lifecycle discovery exceeded its bound.');
    for (const [key, path] of additions) if (!this.files.has(key)) this.files.set(key, {
      path, offset: 0, prefix: Buffer.alloc(0), dev: 0, ino: 0, lastSize: 0,
      historicalEnd: 0, initial: true, discoveredLater, header: null, projector: null, lastOwnedOrdinal: null,
    });
  }

  private header(value: Row): Header {
    const id = value.id, cwd = canonicalizeCwd(value.cwd), version = value.cli_version;
    if (!identity(id) || !cwd || !identity(version)) throw new Error('Invalid lifecycle session identity.');
    const boundary = value.subagent_history_start_ordinal == null ? null : value.subagent_history_start_ordinal;
    if (boundary !== null && !ordinal(boundary)) throw new Error('Invalid lifecycle ownership boundary.');
    if ('attached_thread' in value && typeof value.attached_thread !== 'boolean') throw new Error('Invalid lifecycle attachment marker.');
    const attached = value.attached_thread === true;
    const child = value.parent_thread_id != null || (object(value.source) && object(value.source.subagent));
    const inherited = value.forked_from_id != null || value.history_base != null || attached || value.forked_from_ordinal_exclusive != null;
    // Audited native app-server root forks retain their source thread marker;
    // markerless supplied history accepts ResponseItem[] rather than event_msg.
    // CLI/exec caller paths are not part of this verified observer contract.
    // https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/core/src/thread_manager.rs#L1703-L1707
    // https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/app-server/src/thread_processor.rs#L4921-L4935
    const topLevel = !child && !inherited && value.source === 'vscode';
    // Exact 0.166.0-alpha.5.1 writer proof: copied initialization for this
    // discriminator always writes a boundary before the first own header;
    // referenced inheritance writes history_base. Absence is meaningful only
    // under this discriminator, not merely because a child has no fork ID.
    // https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/core/src/session/session.rs#L1126-L1143
    // https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/thread-store/src/live_thread.rs#L152-L179
    const nativeOwnChild = child && !inherited && boundary === null && value.history_mode === 'paginated'
      && ['subagent', 'guardian_review'].includes(value.thread_source as string);
    const owned = boundary !== null || topLevel || nativeOwnChild;
    return { id, cwd, version, boundary, owned,
      fingerprint: JSON.stringify([id, cwd, version, boundary, owned, child, inherited, typeof value.source === 'string' ? value.source : null,
        value.history_mode ?? null, value.thread_source ?? null,
        identity(value.parent_thread_id) ? value.parent_thread_id : null,
        identity(value.forked_from_id) ? value.forked_from_id : null,
        value.history_base != null, attached, value.forked_from_ordinal_exclusive != null]) };
  }

  private async readFile(original: FileState, budget: { count: number }, observedAt: string): Promise<StagedFile> {
    const file: FileState = { ...original, prefix: Buffer.from(original.prefix), header: original.header ? { ...original.header } : null, projector: original.projector?.clone() ?? null };
    const observations: TurnLifecycleObservation[] = [];
    const firstRead = original.initial;
    const handle = await open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < file.lastSize) throw new Error('Lifecycle file changed.');
      if (!file.initial) {
        if (file.ino && stat.ino && (file.ino !== stat.ino || file.dev !== stat.dev)) throw new Error('Lifecycle file replaced.');
        const check = Buffer.alloc(file.prefix.length);
        const read = await handle.read(check, 0, check.length, 0);
        if (read.bytesRead !== check.length || !check.equals(file.prefix)) throw new Error('Lifecycle file replaced.');
      } else {
        file.dev = stat.dev; file.ino = stat.ino; file.historicalEnd = stat.size;
        file.prefix = Buffer.alloc(Math.min(256, stat.size));
        const read = await handle.read(file.prefix, 0, file.prefix.length, 0);
        if (read.bytesRead !== file.prefix.length) throw new Error('Short lifecycle read.');
      }
      const consume = (line: Buffer, historical: boolean) => {
        const record: unknown = JSON.parse(line.toString('utf8'));
        if (!object(record)) throw new Error('Invalid lifecycle record.');
        if (record.type === 'session_meta') {
          if (!object(record.payload)) throw new Error('Invalid lifecycle session metadata.');
          // The first header owns the file. Forked files may contain a copied
          // parent's later header inside their explicitly inherited prefix.
          if (file.header?.boundary !== null && file.header?.boundary !== undefined
              && ordinal(record.ordinal) && record.ordinal < file.header.boundary) return;
          const next = this.header(record.payload);
          const pathKey = canonicalizeCwd(file.path)!;
          const claims = this.identityClaims.get(pathKey) ?? new Set<string>();
          claims.add(next.id); this.identityClaims.set(pathKey, claims);
          if (file.header && file.header.fingerprint !== next.fingerprint) throw new Error('Lifecycle session identity changed.');
          file.header = next;
          if (!file.projector && next.owned && this.allowed.has(next.cwd) && this.versions.has(next.version)) {
            file.projector = createRolloutLifecycleProjector({ source: 'codex', sourceNamespace: this.options.sourceNamespace, threadId: next.id, agentId: next.id });
          }
          return;
        }
        if (!file.header) throw new Error('Lifecycle record lacks session metadata.');
        if (!file.projector) return;
        const projection: ProjectedRolloutLifecycleRecord | null = projectRolloutLifecycleRecord(record);
        if (!projection) return;
        if (file.header.boundary !== null) {
          if (projection.ordinal === null) throw new Error('Lifecycle record lacks ownership ordinal.');
          if (projection.ordinal < file.header.boundary) return;
        }
        if (projection.ordinal !== null) {
          if (file.lastOwnedOrdinal !== null && projection.ordinal <= file.lastOwnedOrdinal) throw new Error('Lifecycle ordinal is not increasing.');
          file.lastOwnedOrdinal = projection.ordinal;
        }
        if (++budget.count > MAX_RECORDS_PER_SCAN) throw new Error('Lifecycle scan exceeded its record bound.');
        const result = file.projector.observe(projection, { delivery: historical ? 'history' : 'live', observedAt });
        if (result.kind === 'observed') observations.push(result.observation);
      };
      let position = file.offset, lineStart = position, pieces: Buffer[] = [], lineLength = 0;
      while (position < stat.size) {
        const length = Math.min(READ_CHUNK_BYTES, stat.size - position), data = Buffer.alloc(length);
        const read = await handle.read(data, 0, length, position);
        if (read.bytesRead !== length) throw new Error('Short lifecycle read.');
        let start = 0;
        for (let i = 0; i < data.length; i++) if (data[i] === 10) {
          const part = data.subarray(start, i); lineLength += part.length;
          if (lineLength > MAX_LINE_BYTES) throw new Error('Oversized lifecycle line.');
          pieces.push(part); consume(Buffer.concat(pieces, lineLength), lineStart < file.historicalEnd);
          file.offset = position + i + 1; lineStart = file.offset; pieces = []; lineLength = 0; start = i + 1;
        }
        const tail = data.subarray(start); lineLength += tail.length;
        if (lineLength > MAX_LINE_BYTES) throw new Error('Oversized lifecycle line.');
        if (tail.length) pieces.push(tail);
        position += length;
      }
      const after = await handle.stat();
      if (after.size < stat.size || (file.ino && after.ino && (file.ino !== after.ino || file.dev !== after.dev))) throw new Error('Lifecycle file changed during read.');
      file.lastSize = stat.size; file.initial = false;
      return { state: file, observations, firstRead };
    } finally { await handle.close(); }
  }
}
