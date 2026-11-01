import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readScope } from '../src/chatgpt/snapshot.js';

const args = process.argv.slice(2);
const directories: string[] = [];
for (let i = 0; i < args.length; i += 2) {
  if (args[i] !== '--project' || !args[i + 1] || !isAbsolute(args[i + 1])) throw new Error('Use --project /absolute/directory, repeated for each project.');
  directories.push(args[i + 1]);
}
const scope = readScope(JSON.stringify(directories));
const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(root, 'plugins/petstown');
await mkdir(target, { recursive: true });
for (const file of ['server.mjs', 'office.html']) await copyFile(resolve(root, 'dist-chatgpt', file), resolve(target, file));
// Machine-specific config is generated and ignored by Git. The installed Desktop
// loader discovers .mcp.json through .codex-plugin/plugin.json. A portable root
// plugin.json shadows this declaration on Desktop 26.1027, yielding zero servers.
await writeFile(resolve(target, '.mcp.json'), JSON.stringify({
  mcpServers: { petstown: {
    command: 'node', args: ['./server.mjs'], cwd: '.',
    env_vars: ['CODEX_HOME'],
    env: { PETSTOWN_METADATA_CWDS: JSON.stringify(scope),
      ...(process.env.PETSTOWN_METADATA_SOCKET ? { PETSTOWN_METADATA_SOCKET: process.env.PETSTOWN_METADATA_SOCKET } : {}),
      ...(process.env.PETSTOWN_ROLLOUT_ROOT ? { PETSTOWN_ROLLOUT_ROOT: process.env.PETSTOWN_ROLLOUT_ROOT } : {}),
      ...(process.env.PETSTOWN_ROLLOUT_FILES ? { PETSTOWN_ROLLOUT_FILES: process.env.PETSTOWN_ROLLOUT_FILES } : {}) },
  } },
}, null, 2) + '\n');
console.log(`Packaged PetsTown for ${scope.length} explicit project(s). Install petstown@petstown-local from this repository.`);
