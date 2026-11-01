import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { connectOffice, presentationAction } from './connection';
import { createOfficeStore } from './store';
import { event, snapshot } from './test-helpers';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  handlers = new Map<string, EventListener>();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: EventListener) { this.handlers.set(type, listener); }
  close() { this.closed = true; }
  emit(value: unknown) { this.handlers.get('office')?.({ data: JSON.stringify(value) } as unknown as Event); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function mockTransport(t: TestContext, fetcher: typeof fetch) {
  const previousFetch = globalThis.fetch;
  const previousSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  globalThis.fetch = fetcher;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.EventSource = previousSource; });
}

test('snapshot cursor closes the fetch-to-stream gap and stream replay updates the store', async t => {
  mockTransport(t, async () => response(snapshot(8)));
  const store = createOfficeStore();
  const connection = connectOffice(store, { baseUrl: 'http://localhost:1234/' });
  t.after(connection.stop);
  await settle();
  const source = FakeEventSource.instances[0];
  assert.equal(source.url, 'http://localhost:1234/api/events?cursor=epoch-a%3A8');
  source.onopen?.();
  source.emit(event(9, 'agent.state.changed', { runtimeState: 'idle' }));
  assert.equal(store.getState().transport.status, 'connected');
  assert.equal(store.getState().snapshot!.lastSeq, 9);
});

test('latest refresh wins when older requests finish late, even across epoch changes', async t => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let count = 0;
  mockTransport(t, async () => (++count === 1 ? first.promise : second.promise));
  const store = createOfficeStore();
  const connection = connectOffice(store);
  t.after(connection.stop);
  const refresh = connection.refresh();
  second.resolve(response(snapshot(1, 'epoch-b')));
  await refresh;
  first.resolve(response(snapshot(100, 'epoch-a')));
  await settle();
  assert.equal(store.getState().snapshot!.bridgeEpoch, 'epoch-b');
  assert.equal(FakeEventSource.instances.length, 1);
});

test('sequence gaps resnapshot; queued events from the replaced stream are ignored', async t => {
  const repair = deferred<Response>();
  let count = 0;
  mockTransport(t, async () => ++count === 1 ? response(snapshot()) : repair.promise);
  const store = createOfficeStore();
  const connection = connectOffice(store);
  t.after(connection.stop);
  await settle();
  const oldSource = FakeEventSource.instances[0];
  oldSource.emit(event(2, 'agent.state.changed', { runtimeState: 'error' }));
  assert.equal(oldSource.closed, true);
  oldSource.emit(event(1, 'agent.closed', { reason: null }));
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  repair.resolve(response(snapshot(2)));
  await settle();
  assert.match(FakeEventSource.instances[1].url, /epoch-a%3A2$/);
  assert.equal(store.getState().error, null);
});

test('stop cancels pending fetch and stale callbacks never reconnect or update', async t => {
  const pending = deferred<Response>();
  mockTransport(t, async () => pending.promise);
  const store = createOfficeStore();
  const connection = connectOffice(store);
  connection.stop();
  pending.resolve(response(snapshot()));
  await settle();
  await connection.refresh();
  assert.equal(store.getState().snapshot, null);
  assert.equal(store.getState().transport.status, 'disconnected');
  assert.equal(FakeEventSource.instances.length, 0);
});

test('invalid JSON/schema never replaces good data, and stream failure is not agent failure', async t => {
  let count = 0;
  mockTransport(t, async () => ++count === 1 ? response(snapshot()) : response({ agents: null }));
  const store = createOfficeStore();
  const connection = connectOffice(store);
  t.after(connection.stop);
  await settle();
  FakeEventSource.instances[0].handlers.get('office')?.({ data: 'not json' } as unknown as Event);
  await settle();
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  assert.equal(store.getState().transport.status, 'disconnected');
  assert.match(store.getState().transport.message!, /Invalid office snapshot/);
});

test('native EventSource error closes stream and keeps source health separate', async t => {
  mockTransport(t, async () => response(snapshot()));
  const store = createOfficeStore();
  const connection = connectOffice(store);
  t.after(connection.stop);
  await settle();
  const source = FakeEventSource.instances[0];
  source.onerror?.();
  assert.equal(source.closed, true);
  assert.equal(store.getState().transport.status, 'reconnecting');
  assert.equal(store.getState().snapshot!.connection.status, 'connected');
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
});

test('browser offline updates immediately; online resnapshots and stop removes listeners', async t => {
  const previousWindow = globalThis.window;
  const browser = Object.assign(new EventTarget(), { navigator: { onLine: true } });
  globalThis.window = browser as unknown as typeof window;
  t.after(() => { globalThis.window = previousWindow; });
  let fetches = 0;
  mockTransport(t, async () => { fetches++; return response(snapshot()); });
  const store = createOfficeStore();
  const connection = connectOffice(store);
  t.after(connection.stop);
  await settle();
  const source = FakeEventSource.instances[0];
  source.onopen?.();
  browser.dispatchEvent(new Event('offline'));
  assert.equal(store.getState().transport.status, 'disconnected');
  assert.equal(source.closed, true);
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'working');
  await connection.refresh();
  assert.equal(fetches, 1);
  browser.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(fetches, 2);
  FakeEventSource.instances[1].onopen?.();
  assert.equal(store.getState().transport.status, 'connected');
  connection.stop();
  browser.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(fetches, 2);
});

test('presentation uses current control token, leaves Origin to browser, and cannot roll back newer events', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const lateSnapshot = deferred<Response>();
  mockTransport(t, async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1 ? response({ presentation: { state: 'live', canSkip: false } }) : lateSnapshot.promise;
  });
  const store = createOfficeStore(snapshot(4));
  const action = presentationAction(store, 'skip', 'http://localhost:1234');
  await settle();
  store.applyEvent(event(5, 'agent.state.changed', { runtimeState: 'error' }));
  lateSnapshot.resolve(response(snapshot(4)));
  await action;
  assert.equal(calls[0].url, 'http://localhost:1234/api/presentation/skip');
  assert.equal(calls[0].init!.method, 'POST');
  assert.deepEqual(calls[0].init!.headers, { 'X-Office-Token': 'test-control-token' });
  assert.equal(store.getState().snapshot!.lastSeq, 5);
  assert.equal(store.getState().snapshot!.agents[0].runtimeState, 'error');
});

test('presentation fails explicitly without token or on rejected POST', async t => {
  let calls = 0;
  mockTransport(t, async () => { calls++; return response({ error: 'forbidden' }, 403); });
  await assert.rejects(presentationAction(createOfficeStore(), 'start'), /token/);
  assert.equal(calls, 0);
  await assert.rejects(presentationAction(createOfficeStore(snapshot()), 'reset'), /403/);
  assert.equal(calls, 1);
});
