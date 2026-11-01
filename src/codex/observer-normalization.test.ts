import assert from 'node:assert/strict';
import test from 'node:test';
import { agentSemanticFingerprint, canonicalizeCwd, normalizeRuntimeState, normalizeThreadMetadata } from './observer-normalization.js';

// SYNTHETIC fixtures only. These rows and asset keys are not evidence of a live Codex run.
const syntheticOptions = {
  allowedCwds: new Set(['/synthetic/project']),
  observedAt: '2026-11-01T12:00:00.000Z',
  petAssets: [{ assetId: 'synthetic-approved-pet-a' }, { assetId: 'synthetic-approved-pet-b' }],
};
const syntheticThread = (extra: Record<string, unknown> = {}) => ({
  id: 'synthetic-thread-a', cwd: '/synthetic/project',
  status: { type: 'active', activeFlags: [] }, ...extra,
});
const normalize = (extra: Record<string, unknown> = {}) => {
  const result = normalizeThreadMetadata(syntheticThread(extra), syntheticOptions);
  assert.ok(result);
  return result;
};

test('synthetic: stable source identity, direct parent, role and explicit project survive normalization', () => {
  const { agent, project } = normalize({
    parentThreadId: 'synthetic-parent', projectId: 'synthetic-project-id',
    agentNickname: 'Synthetic worker', name: 'Synthetic fallback', agentRole: 'reviewer',
  });
  assert.equal(agent.agentId, 'synthetic-thread-a');
  assert.equal(agent.parentAgentId, 'synthetic-parent');
  assert.equal(agent.projectId, 'synthetic-project-id');
  assert.equal(project.projectId, agent.projectId);
  assert.equal(agent.displayName, 'Synthetic worker');
  assert.equal(agent.role, 'reviewer');
  assert.equal(agent.lastObservedAt, syntheticOptions.observedAt);
});

test('synthetic: unverified nested parent and task/activity/request text stay unknown', () => {
  const { agent } = normalize({
    source: { subAgent: { thread_spawn: { parent_thread_id: 'synthetic-unverified-parent' } } },
    preview: 'SYNTHETIC_PRIVATE_PROMPT', turns: [{ text: 'SYNTHETIC_PRIVATE_PROMPT' }],
    task: 'SYNTHETIC_PRIVATE_PROMPT', pendingRequests: [{ question: 'SYNTHETIC_PRIVATE_PROMPT' }],
  });
  assert.equal(agent.parentAgentId, null);
  assert.equal(agent.task, null);
  assert.equal(agent.activityKind, 'unknown');
  assert.deepEqual(agent.pendingRequestIds, []);
  assert.deepEqual(agent.recentActivity, []);
  assert.ok(!JSON.stringify(agent).includes('SYNTHETIC_PRIVATE_PROMPT'));
});

test('synthetic: runtime states preserve waiting flags and never infer closure/completion', () => {
  for (const [status, expected] of [
    [{ type: 'active', activeFlags: [] }, 'working'],
    [{ type: 'active', activeFlags: ['waitingOnUserInput'] }, 'waiting-for-input'],
    [{ type: 'active', activeFlags: ['waitingOnApproval'] }, 'waiting-for-approval'],
    [{ type: 'active', activeFlags: ['waitingOnUserInput', 'waitingOnApproval'] }, 'waiting-for-approval'],
    [{ type: 'idle' }, 'idle'], [{ type: 'systemError' }, 'error'],
    [{ type: 'notLoaded' }, 'unknown'], [{ type: 'closed' }, 'unknown'],
    [{ type: 'completed' }, 'unknown'], [null, 'unknown'], ['active', 'unknown'],
  ] as const) assert.equal(normalizeRuntimeState(status), expected);
});

test('synthetic: connection loss is not agent error or completion', () => {
  assert.equal(normalize({ connection: { status: 'disconnected' } }).agent.runtimeState, 'working');
  assert.equal(normalize({ status: { type: 'idle' }, connection: { status: 'reconnecting' } }).agent.runtimeState, 'idle');
});

test('synthetic: absolute POSIX identities normalize separators/dot paths but preserve case', () => {
  assert.equal(canonicalizeCwd('/synthetic/project/../project/'), '/synthetic/project');
  assert.equal(canonicalizeCwd('/'), '/');
  assert.equal(canonicalizeCwd('/Synthetic/Project'), '/Synthetic/Project');
  assert.equal(canonicalizeCwd('synthetic/project'), null);
  assert.equal(canonicalizeCwd('file:///synthetic/project'), null);
  assert.equal(canonicalizeCwd('/synthetic/\0project'), null);
  const result = normalize({ cwd: '/synthetic/project/./' });
  assert.equal(result.project.projectId, 'cwd:/synthetic/project');
  assert.equal(result.project.displayName, 'project');
});

test('synthetic: Windows identities are stable across slash/case differences on any test host', () => {
  assert.equal(canonicalizeCwd('C:/Synthetic/Project/../Project/'), 'c:\\synthetic\\project');
  assert.equal(canonicalizeCwd('C:\\'), 'c:\\');
  assert.equal(canonicalizeCwd('C:relative'), null);
  assert.equal(canonicalizeCwd('\\\\Server\\Share\\Project\\'), '\\\\server\\share\\project');
  const result = normalizeThreadMetadata(syntheticThread({ cwd: 'C:/SYNTHETIC/Project/' }), {
    ...syntheticOptions, allowedCwds: ['c:\\synthetic\\project'],
  });
  assert.ok(result);
  assert.equal(result.project.projectId, 'cwd:c:\\synthetic\\project');
});

test('synthetic: invalid metadata and non-allowlisted directories are rejected', () => {
  for (const value of [null, [], 'thread', {}, syntheticThread({ id: '' }), syntheticThread({ id: 7 }),
    syntheticThread({ cwd: 'relative' }), syntheticThread({ cwd: '/synthetic/other' }),
    syntheticThread({ cwd: '/synthetic/project/child' })]) {
    assert.equal(normalizeThreadMetadata(value, syntheticOptions), null);
  }
});

test('synthetic: supplied approved pet assignment is independent of discovery order/reconnect', () => {
  const first = normalize().agent;
  normalize({ id: 'synthetic-thread-b' });
  const reconnected = normalizeThreadMetadata(syntheticThread(), {
    ...syntheticOptions, observedAt: '2026-11-01T12:01:00.000Z',
  });
  assert.ok(reconnected);
  assert.equal(reconnected.agent.petAssetId, first.petAssetId);
  assert.ok(syntheticOptions.petAssets.some(asset => asset.assetId === first.petAssetId));
  assert.equal(normalizeThreadMetadata(syntheticThread(), { ...syntheticOptions, petAssets: [] })?.agent.petAssetId, null);
});

test('synthetic: timestamp-only polls deduplicate; meaningful runtime/identity/request changes do not', () => {
  const agent = normalize().agent;
  const fingerprint = agentSemanticFingerprint(agent);
  assert.equal(agentSemanticFingerprint({ ...agent, lastObservedAt: '2026-11-01T12:02:00.000Z' }), fingerprint);
  assert.notEqual(agentSemanticFingerprint({ ...agent, runtimeState: 'idle' }), fingerprint);
  assert.notEqual(agentSemanticFingerprint({ ...agent, parentAgentId: 'synthetic-parent' }), fingerprint);
  assert.notEqual(agentSemanticFingerprint({ ...agent, pendingRequestIds: ['synthetic-request'] }), fingerprint);
});

test('synthetic: normalization does not mutate or retain raw input objects', () => {
  const raw = Object.freeze(syntheticThread({ status: Object.freeze({ type: 'idle' }) }));
  const result = normalizeThreadMetadata(raw, syntheticOptions);
  assert.ok(result);
  result.agent.pendingRequestIds.push('synthetic-local-change');
  assert.deepEqual(normalizeThreadMetadata(raw, syntheticOptions)?.agent.pendingRequestIds, []);
  assert.deepEqual(raw.status, { type: 'idle' });
});
