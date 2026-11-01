/** Best-effort wake-ups only. Readers still perform all scope and ownership checks. */
import { watch, type FSWatcher } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export function watchRollouts(options: { root?: string; files: readonly string[] }, wake: () => void): () => void {
  const watchers: FSWatcher[] = [];
  let stopped = false;
  const locations = new Map<string, boolean>();
  if (options.root && isAbsolute(options.root)) locations.set(options.root, true);
  for (const file of options.files) if (isAbsolute(file)) {
    const dir = dirname(file);
    if (!locations.has(dir)) locations.set(dir, false);
  }
  // Bound handles even if the caller supplies an unexpectedly large file list.
  for (const [path, recursive] of [...locations].slice(0, 128)) {
    try {
      const watcher = watch(path, { recursive }, () => { if (!stopped) wake(); });
      watcher.on('error', () => { watcher.close(); });
      watchers.push(watcher);
    } catch { /* Unsupported or missing paths fall back to periodic reconciliation. */ }
  }
  return () => { if (stopped) return; stopped = true; for (const watcher of watchers) watcher.close(); };
}
