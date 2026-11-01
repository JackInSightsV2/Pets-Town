import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { OfficeAgent, OfficeProject, PetAsset, RuntimeState } from '../shared/contract.js';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

/** Format an existing native task name; never infer one from prompt or transcript content. */
function nativeTaskName(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/root\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value)) return null;
  return value.slice(value.lastIndexOf('/') + 1).replace(/[_-]+/g, ' ');
}

export interface ThreadNormalizationOptions {
  /** Exact working directories permitted for this observer; descendants are not implicitly included. */
  allowedCwds: ReadonlySet<string> | readonly string[];
  observedAt: string;
  /** Only asset identifiers from the caller's approved manifest. */
  petAssets: readonly Pick<PetAsset, 'assetId'>[];
}

/** Lexical identity only: does not inspect, follow symlinks, or change the working directory. */
export function canonicalizeCwd(value: unknown): string | null {
  const cwd = text(value);
  if (!cwd || cwd.includes('\0')) return null;
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(cwd)) {
    let normalized = win32.normalize(cwd);
    if (!win32.isAbsolute(normalized)) return null;
    const root = win32.parse(normalized).root;
    while (normalized.length > root.length && normalized.endsWith('\\')) normalized = normalized.slice(0, -1);
    return normalized.toLowerCase();
  }
  if (!posix.isAbsolute(cwd)) return null;
  let normalized = posix.normalize(cwd);
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

/** Connection health is deliberately not an input to runtime-state normalization. */
export function normalizeRuntimeState(status: unknown): RuntimeState {
  if (!object(status)) return 'unknown';
  switch (status.type) {
    case 'systemError': return 'error';
    case 'idle': return 'idle';
    case 'active': {
      const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
      if (flags.includes('waitingOnApproval')) return 'waiting-for-approval';
      if (flags.includes('waitingOnUserInput')) return 'waiting-for-input';
      return 'working';
    }
    // notLoaded does not establish closure or successful completion.
    default: return 'unknown';
  }
}

/** Normalize result.thread from thread/read(includeTurns:false), retaining no transcript or guessed relationship. */
export function normalizeThreadMetadata(value: unknown, options: ThreadNormalizationOptions): { agent: OfficeAgent; project: OfficeProject } | null {
  if (!object(value)) return null;
  const agentId = text(value.id);
  const cwd = canonicalizeCwd(value.cwd);
  if (!agentId || !cwd) return null;
  const allowed = new Set([...options.allowedCwds].map(canonicalizeCwd).filter((path): path is string => path !== null));
  if (!allowed.has(cwd)) return null;
  const parentAgentId = text(value.parentThreadId);
  const projectId = text(value.projectId) ?? `cwd:${cwd}`;
  const path = /^[a-z]:\\|^\\\\/i.test(cwd) ? win32 : posix;
  const project: OfficeProject = { projectId, displayName: path.basename(cwd) || cwd, cwd };
  // Match the manual observer's assignment; discovery order/reconnect cannot reassign a pet.
  const index = options.petAssets.length ? createHash('sha256').update(agentId).digest()[0] % options.petAssets.length : -1;
  const agent: OfficeAgent = {
    agentId, parentAgentId, projectId,
    displayName: text(value.name) ?? nativeTaskName(value.agentPath) ?? text(value.agentNickname) ?? `${parentAgentId ? 'Subagent' : 'Agent'} ${agentId.slice(0, 8)}`,
    role: text(value.agentRole), task: null,
    runtimeState: normalizeRuntimeState(value.status), activityKind: 'unknown',
    lastObservedAt: options.observedAt, pendingRequestIds: [],
    petAssetId: index < 0 ? null : options.petAssets[index].assetId, recentActivity: [],
  };
  return { agent, project };
}

/** Poll timestamps alone must not produce duplicate upserts. Source content remains significant. */
export function agentSemanticFingerprint(agent: OfficeAgent): string {
  return JSON.stringify([
    agent.agentId, agent.parentAgentId, agent.projectId, agent.displayName, agent.role,
    agent.task, agent.runtimeState, agent.activityKind, agent.pendingRequestIds,
    agent.petAssetId, agent.recentActivity,
  ]);
}
