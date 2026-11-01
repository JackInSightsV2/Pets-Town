/** Read-only Mac probe. Output contains status flags only, never request payloads or IDs. */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { MetadataRpc } from '../metadata-rpc.js';

const threadId = process.env.PETSTOWN_PROBE_THREAD_ID;
if (!threadId) throw new Error('Set PETSTOWN_PROBE_THREAD_ID to the operator-prepared existing thread ID.');
const socket = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
const rpc = await MetadataRpc.connect(socket);
try {
  let previous = '';
  // Ninety seconds gives the operator time to open and resolve a benign request.
  for (let sample = 0; sample < 45; sample++) {
    const result = await rpc.call('thread/read', { threadId, includeTurns: false });
    const thread = (result as { thread?: { id?: unknown; status?: { type?: unknown; activeFlags?: unknown } } })?.thread;
    if (thread?.id !== threadId) throw new Error('Thread identity mismatch.');
    const status = thread.status;
    const type = ['active', 'idle', 'notLoaded', 'systemError'].includes(String(status?.type)) ? status?.type : 'unknown';
    const flags = Array.isArray(status?.activeFlags) ? status.activeFlags.filter((flag): flag is string => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput') : [];
    const line = JSON.stringify({ type, flags });
    if (line !== previous) { console.log(line); previous = line; }
    if (sample < 44) await new Promise(done => setTimeout(done, 2000));
  }
} finally { rpc.close(); }
