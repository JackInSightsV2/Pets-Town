import type { OfficeStore } from './store';
import { RESYNC_REQUIRED } from './store';
import { isOfficeEvent, isOfficeSnapshot } from './validation';

const endpoint = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unable to reach the office bridge.';

export function connectOffice(store: OfficeStore, options: { baseUrl?: string } = {}): { stop(): void; refresh(): Promise<void> } {
  const base = options.baseUrl ?? '';
  let stopped = false;
  let generation = 0;
  let controller: AbortController | null = null;
  let stream: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const browser = typeof window === 'undefined' ? null : window;
  let offline = browser?.navigator.onLine === false;
  const closeStream = () => { stream?.close(); stream = null; };
  const clearRetry = () => { if (retry !== null) clearTimeout(retry); retry = null; };
  const scheduleRetry = () => {
    clearRetry();
    if (!stopped && !offline) retry = setTimeout(() => { retry = null; void refresh().catch(() => {}); }, 1000);
  };
  function restart(message: string) {
    closeStream();
    store.setTransportStatus('reconnecting', message);
    void refresh().catch(() => {});
  }
  function openStream(version: number) {
    const snapshot = store.getState().snapshot!;
    const cursor = encodeURIComponent(`${snapshot.bridgeEpoch}:${snapshot.lastSeq}`);
    const current = new EventSource(endpoint(base, `/api/events?cursor=${cursor}`));
    stream = current;
    const active = () => !stopped && version === generation && stream === current;
    current.onopen = () => { if (active()) store.setTransportStatus('connected'); };
    const onEvent = (message: MessageEvent) => {
      if (!active()) return;
      try {
        const event: unknown = JSON.parse(message.data);
        if (!isOfficeEvent(event)) throw new Error('Invalid office event received.');
        store.applyEvent(event);
        if (store.getState().error === RESYNC_REQUIRED) restart(RESYNC_REQUIRED);
      } catch (error) { restart(errorMessage(error)); }
    };
    current.addEventListener('office', onEvent as EventListener);
    current.onmessage = onEvent;
    // EventSource hides HTTP errors (including cursor-expired 409). Always re-snapshot before reconnecting.
    current.onerror = () => {
      if (!active()) return;
      closeStream();
      store.setTransportStatus('reconnecting', 'The office stream disconnected. Reconnecting…');
      scheduleRetry();
    };
  }
  async function refresh(): Promise<void> {
    if (stopped) return;
    if (offline) { store.setTransportStatus('disconnected', 'Browser is offline. Reconnect to restore office updates.'); return; }
    const version = ++generation;
    clearRetry();
    closeStream();
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    store.setTransportStatus(store.getState().snapshot ? 'reconnecting' : 'connecting');
    try {
      const response = await fetch(endpoint(base, '/api/office'), { signal: requestController.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Office snapshot request failed (${response.status}).`);
      const snapshot: unknown = await response.json();
      if (stopped || version !== generation) return;
      if (!isOfficeSnapshot(snapshot)) throw new Error('Invalid office snapshot received.');
      store.applySnapshot(snapshot);
      if (store.getState().error === RESYNC_REQUIRED) throw new Error(RESYNC_REQUIRED);
      openStream(version);
    } catch (error) {
      if (stopped || version !== generation) return;
      store.setTransportStatus('disconnected', errorMessage(error));
      scheduleRetry();
      throw error;
    } finally { if (controller === requestController) controller = null; }
  }
  const onOffline = () => {
    if (stopped) return;
    offline = true;
    generation++;
    controller?.abort();
    clearRetry();
    closeStream();
    store.setTransportStatus('disconnected', 'Browser is offline. Reconnect to restore office updates.');
  };
  const onOnline = () => {
    if (stopped) return;
    offline = false;
    void refresh().catch(() => {});
  };
  browser?.addEventListener('offline', onOffline);
  browser?.addEventListener('online', onOnline);
  void refresh().catch(() => {});
  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      controller?.abort();
      clearRetry();
      closeStream();
      browser?.removeEventListener('offline', onOffline);
      browser?.removeEventListener('online', onOnline);
      store.setTransportStatus('disconnected', 'Office connection stopped.');
    },
  };
}

export async function presentationAction(store: OfficeStore, action: 'start' | 'skip' | 'reset', baseUrl = '', isCurrent = () => true): Promise<void> {
  if (!isCurrent()) return;
  const token = store.getState().snapshot?.controlToken;
  if (!token) throw new Error('The office control token is unavailable. Refresh the office and try again.');
  const response = await fetch(endpoint(baseUrl, `/api/presentation/${action}`), {
    method: 'POST', headers: { 'X-Office-Token': token },
  });
  if (!isCurrent()) return;
  if (!response.ok) throw new Error(`Unable to ${action} the office presentation (${response.status}).`);
  // The POST returns presentation metadata, not an ordered snapshot. Read the authoritative clock.
  const current = await fetch(endpoint(baseUrl, '/api/office'), { cache: 'no-store' });
  if (!current.ok) throw new Error(`Office snapshot request failed (${current.status}).`);
  const snapshot: unknown = await current.json();
  if (!isCurrent()) return;
  if (!isOfficeSnapshot(snapshot)) throw new Error('Invalid office snapshot received.');
  store.applySnapshot(snapshot);
}
