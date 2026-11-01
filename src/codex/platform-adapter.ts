import { homedir } from 'node:os';
import { resolve, win32 } from 'node:path';
import { createAdapter as metadata } from './metadata-adapter.js';
import { createAdapter as rollout } from './rollout-adapter.js';
import type { OfficeAdapter } from '../server/adapter.js';

/** Select a passive source without starting or taking ownership of agents. */
export function observationSource(platform = process.platform, env = process.env, home = homedir()) {
  const paths = platform === 'win32' ? win32 : { resolve };
  if (env.PETSTOWN_ROLLOUT_ROOT || env.PETSTOWN_ROLLOUT_FILES || platform === 'win32') {
    return { kind: 'rollout' as const, defaultRoot: paths.resolve(env.CODEX_HOME ?? paths.resolve(home, '.codex'), 'sessions') };
  }
  return { kind: 'metadata' as const };
}

export async function createAdapter(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  metadata?: () => Promise<OfficeAdapter>;
  rollout?: (options: { defaultRoot: string }) => Promise<OfficeAdapter>;
} = {}): Promise<OfficeAdapter> {
  const source = observationSource(options.platform, options.env, options.home);
  return source.kind === 'metadata'
    ? (options.metadata ?? metadata)()
    : (options.rollout ?? rollout)({ defaultRoot: source.defaultRoot });
}
