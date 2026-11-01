// Read-only diagnostic: no raw IDs, paths, prompts or transcripts are printed.
import WebSocket from 'ws';
import { createHmac, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const socketPath = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
if (process.platform === 'win32' || !socketPath.startsWith('/') || socketPath.includes(':')) throw new Error('An existing Unix daemon socket is required.');
const ws = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: 5000, maxPayload: 20 * 1024 * 1024 });
let deadlineReached = false;
const deadline = setTimeout(() => { deadlineReached = true; ws.terminate(); }, 70_000);
const secret = randomBytes(32);
const pseudonym = (value: string) => createHmac('sha256', secret).update(value).digest('hex').slice(0, 12);
const seen = new Set<string>();
const baselinedThreads = new Set<string>();
let id = 0;
const pending = new Map<number, { ok(value: any): void; fail(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
ws.on('message', bytes => {
  let m: any; try { m = JSON.parse(bytes.toString()); } catch { return; }
  if (typeof m?.id !== 'number' || !pending.has(m.id)) return;
  const p = pending.get(m.id)!; pending.delete(m.id); clearTimeout(p.timer);
  if ('error' in m) p.fail(new Error('A read-only request was rejected.')); else p.ok(m.result);
});
const closed = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.fail(new Error('Daemon connection closed.')); } pending.clear(); };
ws.on('error', closed); ws.on('close', closed);
async function call(method: 'initialize' | 'thread/loaded/list' | 'thread/read', params: object): Promise<any> {
  const n = ++id;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { pending.delete(n); fail(new Error('Read-only request timed out.')); }, 5000);
    pending.set(n, { ok, fail, timer });
    ws.send(JSON.stringify({ id: n, method, params }), error => { if (error) { clearTimeout(timer); pending.delete(n); fail(new Error('Send failed.')); } });
  });
}
async function scan(initial: boolean) {
  let cursor: string | undefined;
  const ids = new Set<string>(), cursors = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const list = await call('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(list?.data) || !list.data.every((x: unknown) => typeof x === 'string')) throw new Error('Invalid loaded-thread response.');
    list.data.forEach((x: string) => ids.add(x));
    cursor = typeof list.nextCursor === 'string' && list.nextCursor ? list.nextCursor : undefined;
    if (!cursor) break;
    if (cursors.has(cursor) || page === 99) throw new Error('Pagination limit.');
    cursors.add(cursor);
  }
  let readable = 0, rejected = 0, historyCount = 0, newCount = 0, newlyBaselined = 0;
  for (const threadId of ids) {
    let response: any;
    try { response = await call('thread/read', { threadId, includeTurns: true }); } catch (error) { if (deadlineReached || ws.readyState !== WebSocket.OPEN) throw error; rejected++; continue; }
    if (response?.thread?.id !== threadId || !Array.isArray(response.thread.turns)) { rejected++; continue; }
    readable++;
    const baselineThread = !baselinedThreads.has(threadId);
    if (baselineThread) newlyBaselined++;
    for (const turn of response.thread.turns) {
      if (typeof turn?.id !== 'string' || !Array.isArray(turn.items)) continue;
      for (const item of turn.items) {
        if (item?.type !== 'subAgentActivity' || item.kind !== 'interacted' ||
            typeof item.id !== 'string' || !item.id || typeof item.agentThreadId !== 'string' ||
            !item.agentThreadId || item.agentThreadId === threadId) continue;
        const key = JSON.stringify([threadId, turn.id, item.id]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (baselineThread) historyCount++; else newCount++;
        if (!baselineThread) console.log(JSON.stringify({ result: 'new-interaction', sender: pseudonym(threadId), recipient: pseudonym(item.agentThreadId), item: pseudonym(key), source: 'thread/read history' }));
      }
    }
    baselinedThreads.add(threadId);
  }
  console.log(JSON.stringify({ phase: initial ? 'baseline' : 'poll', loaded: ids.size, readable, rejected, newlyBaselined, historyInteractions: historyCount, newInteractions: newCount }));
}
try {
  await new Promise<void>((ok, fail) => { ws.once('open', ok); ws.once('error', () => fail(new Error('Could not connect to existing daemon.'))); });
  await call('initialize', { clientInfo: { name: 'petstown-handoff-probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  ws.send(JSON.stringify({ method: 'initialized' }));
  await scan(true);
  const end = Date.now() + 60_000;
  while (Date.now() < end) { await new Promise(done => setTimeout(done, 3000)); await scan(false); }
  console.log(JSON.stringify({ result: 'finished', note: 'Counts and pseudonyms are diagnostic only; a new interaction is not yet an Office meeting.' }));
} catch {
  if (deadlineReached) console.log(JSON.stringify({ result: 'deadline', note: 'Time limit reached; baseline or scan may be incomplete. No source capability established.' }));
  else { console.error('Probe connection or read failed; no source capability established.'); process.exitCode = 1; }
}
finally { clearTimeout(deadline); ws.terminate(); }
