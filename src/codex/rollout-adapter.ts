/** Windows-capable fallback: read explicit existing Codex session logs without controlling work. */
import { createMetadataAdapter } from './metadata-adapter.js';
import { discoverRollouts } from './rollout-discovery.js';
import { RolloutReader } from './rollout-reader.js';

export async function createAdapter() {
  const root = process.env.PETSTOWN_ROLLOUT_ROOT;
  const files: unknown = JSON.parse(process.env.PETSTOWN_ROLLOUT_FILES ?? (root ? '[]' : 'null'));
  const cwds: unknown = process.env.PETSTOWN_METADATA_CWDS ? JSON.parse(process.env.PETSTOWN_METADATA_CWDS) : [process.cwd()];
  if (!Array.isArray(files) || !files.every(path => typeof path === 'string')) throw new Error('PETSTOWN_ROLLOUT_FILES must be a JSON array of absolute existing session-log paths.');
  if (!Array.isArray(cwds) || !cwds.every(path => typeof path === 'string')) throw new Error('PETSTOWN_METADATA_CWDS must be a JSON array of absolute project paths.');
  return createMetadataAdapter({
    allowedCwds: cwds,
    sourceDescription: 'Existing Codex session logs. Runtime state reflects recorded lifecycle; active work is confirmed only by new lifecycle records.',
    connect: async () => new RolloutReader(files, root ? () => discoverRollouts(root) : undefined),
  });
}
