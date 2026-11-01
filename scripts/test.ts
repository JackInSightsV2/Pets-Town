import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Discover nested tests without depending on shell-specific glob expansion.
async function tests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => entry.isDirectory()
    ? tests(join(directory, entry.name))
    : Promise.resolve(entry.name.endsWith('.test.ts') ? [join(directory, entry.name)] : [])));
  return groups.flat().sort();
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...await tests('src')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
