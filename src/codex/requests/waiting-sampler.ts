import { setTimeout as sleep } from 'node:timers/promises';

interface ReadOnlyRpc {
  call(method: 'thread/read', params: { threadId: string; includeTurns: false }): Promise<unknown>;
  close(): void;
}

/** A wall-clock bounded observation; expiry closes only this observer connection. */
export async function sampleWaiting(rpc: ReadOnlyRpc, threadId: string, emit: (line: string) => void,
  durationMs = 90_000, intervalMs = 2000): Promise<void> {
  const deadline = performance.now() + durationMs;
  const abort = new AbortController();
  const expire = () => { abort.abort(); rpc.close(); };
  const timer = setTimeout(expire, durationMs);
  let previous = '';
  try {
    while (!abort.signal.aborted && performance.now() < deadline) {
      const result = await rpc.call('thread/read', { threadId, includeTurns: false });
      if (abort.signal.aborted || performance.now() >= deadline) break;
      const thread = (result as { thread?: { id?: unknown; status?: { type?: unknown; activeFlags?: unknown } } })?.thread;
      if (thread?.id !== threadId) throw new Error('Thread identity mismatch.');
      const status = thread.status;
      const type = ['active', 'idle', 'notLoaded', 'systemError'].includes(String(status?.type)) ? status?.type : 'unknown';
      const flags = Array.isArray(status?.activeFlags) ? status.activeFlags.filter((flag): flag is string => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput') : [];
      const line = JSON.stringify({ type, flags });
      if (line !== previous) { emit(line); previous = line; }
      await sleep(intervalMs, undefined, { signal: abort.signal });
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally { clearTimeout(timer); rpc.close(); }
}
