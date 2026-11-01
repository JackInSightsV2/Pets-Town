import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// Match the reader's maximum and bound traversal independently of file count.
const MAX_FILES = 1000;
const MAX_DIRECTORIES = 10000;
const MAX_DEPTH = 8;

/** Discover rollout files beneath an explicit root without following links. */
export async function discoverRollouts(root: string): Promise<string[]> {
  if (!isAbsolute(root) || root.includes('\0')) throw new Error('Discovery root must be an absolute path.');
  const pending = [{ path: root, depth: 0 }];
  const files: string[] = [];
  let visited = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    if (++visited > MAX_DIRECTORIES) throw new Error('Rollout discovery directory limit exceeded.');
    let entries;
    try {
      entries = await readdir(directory.path, { withFileTypes: true });
    } catch (error) {
      // A missing root is an empty source; other traversal errors are not a
      // successful partial snapshot. A directory may disappear during a scan.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory.path, entry.name);
      if (entry.isDirectory()) {
        if (directory.depth >= MAX_DEPTH) throw new Error('Rollout discovery depth limit exceeded.');
        pending.push({ path, depth: directory.depth + 1 });
      } else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
        files.push(path);
        if (files.length > MAX_FILES) throw new Error('Rollout discovery file limit exceeded.');
      }
    }
  }
  return files.sort();
}
