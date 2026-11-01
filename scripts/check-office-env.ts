import { execFile } from 'node:child_process';
import { lstat, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MetadataRpc } from '../src/codex/metadata-rpc.js';
import { defaultObserverIdentity } from '../src/server/main.js';
import { builtInPets } from '../src/shared/pets.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npx tsx scripts/check-office-env.ts [--handoffs] [--port PORT]');
  console.log('Read-only Mac launch diagnostics. --handoffs checks the optional 0.166.0 handshake without reading history.');
} else {
  void main().catch(() => { console.log(JSON.stringify({ check: 'diagnostic', status: 'fail', remediation: 'Environment check failed without exposing runtime details.' })); process.exitCode = 1; });
}

async function main() {
  let failed = false;
  function report(check: string, ok: boolean, remediation: string, detail: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ check, status: ok ? 'ok' : 'fail', ...detail, ...(ok ? {} : { remediation }) }));
    if (!ok) failed = true;
  }
  const handoffs = args.includes('--handoffs');
  const portIndex = args.indexOf('--port');
  const portText = portIndex < 0 ? String(handoffs ? 4320 : 4317) : args[portIndex + 1];
  const port = Number(portText);
  const validArgs = args.every((arg, i) => arg === '--handoffs' || arg === '--port' || (portIndex >= 0 && i === portIndex + 1))
    && (portIndex < 0 || (portText !== undefined && /^\d+$/.test(portText)))
    && args.filter(arg => arg === '--port').length <= 1 && args.filter(arg => arg === '--handoffs').length <= 1
    && Number.isInteger(port) && port >= 1 && port <= 65535;
  report('arguments', validArgs, 'Use --help and specify a port from 1 to 65535.');
  if (!validArgs) { process.exitCode = 1; return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  report('node', major > 22 || (major === 22 && minor >= 12), 'Install Node.js 22.12 or newer.');
  report('platform', process.platform === 'darwin', 'Run this check on the target Mac.');

  let scopeOk = false;
  try {
    const paths: unknown = process.env.PETSTOWN_METADATA_CWDS ? JSON.parse(process.env.PETSTOWN_METADATA_CWDS) : [process.cwd()];
    scopeOk = Array.isArray(paths) && paths.length > 0 && paths.every(p => typeof p === 'string' && isAbsolute(p) && !p.includes('\0'));
    if (scopeOk && Array.isArray(paths)) scopeOk = (await Promise.all(paths.map(async p => (await stat(p)).isDirectory()))).every(Boolean);
  } catch { /* Report only a fixed message. */ }
  report('scope', scopeOk, 'Set PETSTOWN_METADATA_CWDS to a nonempty JSON array of existing absolute directories.');

  const root = fileURLToPath(new URL('../', import.meta.url));
  let distOk = false;
  try { distOk = (await stat(resolve(root, 'dist/index.html'))).isFile(); } catch { /* Missing build. */ }
  report('build', distOk, 'Run npm ci, then npm run build in the repository.');

  for (const pet of builtInPets) {
    let ok = false;
    try {
      const path = resolve(root, '.cache/pets', pet.assetId + '.webp');
      const info = await lstat(path);
      if (info.isFile() && !info.isSymbolicLink()) {
        const bytes = await readFile(path);
        const size = webpSize(bytes);
        ok = size !== null && size[0] === pet.width && size[1] === pet.height;
      }
    } catch { /* Missing or invalid cache. */ }
    report('asset-' + pet.assetId, ok, 'Run npm run pets:fetch to refresh the official local pet cache.');
  }

  const socket = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
  let rpc: MetadataRpc | undefined;
  try {
    rpc = await MetadataRpc.connect(socket);
    const result = await rpc.call('thread/loaded/list', { limit: 100 });
    if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data) || !result.data.every(id => typeof id === 'string')) throw new Error();
    report('metadata', true, '', { loadedFirstPage: result.data.length });
  } catch {
    report('metadata', false, 'Verify the existing Codex daemon, or set PETSTOWN_METADATA_SOCKET to its existing Unix socket.');
  } finally { rpc?.close(); }

  if (handoffs) {
    try {
      const { createMacHistoryReader } = await import('../src/codex/handoffs/mac-history-reader.js');
      const reader = await createMacHistoryReader({ isAllowed: () => false });
      try { report('handoffs', reader.version === '0.166.0', 'Use the verified macOS Codex 0.166.0 runtime.'); }
      finally { reader.close(); }
    } catch {
      report('handoffs', false, 'The optional handoff reader is unavailable; verify the reader and macOS Codex 0.166.0 runtime.');
    }
  }
  if (validArgs) {
    let portOk = false;
    let reuse = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) });
      if (response.ok) {
        const health: any = await response.json();
        reuse = !handoffs && scopeOk && health?.service === 'petstown-office' && health.protocolVersion === 1
          && health.source === 'codex' && typeof health.launchIdentity === 'string' && health.launchIdentity === defaultObserverIdentity();
      }
    } catch { /* A free port is checked below. */ }
    if (reuse) portOk = true;
    else {
      portOk = await new Promise<boolean>(done => {
        const server = createServer();
        server.once('error', () => done(false));
        server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
      });
    }
    report('port', portOk, 'Choose a free --port, or reopen the matching existing metadata bridge.', { state: reuse ? 'matching-bridge' : portOk ? 'free' : 'occupied' });
  }
  try {
    const { stdout } = await promisify(execFile)('codex', ['--version'], { timeout: 3000, maxBuffer: 4096, windowsHide: true });
    const version = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
    console.log(JSON.stringify({ check: 'codex-cli', status: version ? 'available' : 'unavailable', ...(version ? { version } : {}) }));
  } catch { console.log(JSON.stringify({ check: 'codex-cli', status: 'unavailable' })); }
  console.log(JSON.stringify({ ready: !failed, mode: handoffs ? 'handoffs' : 'metadata',
    launch: handoffs ? 'npm run office -- --adapter ./src/codex/live-handoff-adapter.ts --port ' + port : 'npm run office -- --port ' + port }));
  if (failed) process.exitCode = 1;
}

function webpSize(b: Buffer): [number, number] | null {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP'
    || b.readUInt32LE(4) + 8 !== b.length) return null;
  const type = b.toString('ascii', 12, 16);
  if (type === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (type === 'VP8L' && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
  }
  if (type === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return null;
}
