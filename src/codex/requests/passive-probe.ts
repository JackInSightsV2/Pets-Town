/** Read-only Mac probe. Output contains status flags only, never request payloads or IDs. */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { sampleWaiting } from './waiting-sampler.js';
import { MetadataRpc } from '../metadata-rpc.js';

const threadId = process.env.PETSTOWN_PROBE_THREAD_ID;
if (!threadId) throw new Error('Set PETSTOWN_PROBE_THREAD_ID to the operator-prepared existing thread ID.');
const socket = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
const rpc = await MetadataRpc.connect(socket);
await sampleWaiting(rpc, threadId, line => console.log(line));
