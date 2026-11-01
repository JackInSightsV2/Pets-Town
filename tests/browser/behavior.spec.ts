import { createHash, randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { OfficeHandoff, OfficeSnapshot } from '../../src/shared/contract.js';
import type { TurnLifecycleObservation } from '../../src/shared/turn-lifecycle.js';

type SyntheticTurn = { agentId: string; turnId: string; startedAt: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let sourceTime = 0;
let parentTurn: SyntheticTurn;
let childTurn: SyntheticTurn;
const newTurn = (agentId: string): SyntheticTurn => ({ agentId, turnId: `turn-v1-${hash(randomUUID())}`, startedAt: ++sourceTime });

async function office(request: APIRequestContext): Promise<OfficeSnapshot> {
  return (await request.get('/api/office')).json() as Promise<OfficeSnapshot>;
}
async function emit(request: APIRequestContext, type: string, agentId: string | null, data: unknown) {
  const response = await request.post('http://127.0.0.1:5418/events', { data: { type, agentId, data } });
  expect(response.ok()).toBeTruthy();
}
async function observe(request: APIRequestContext, turn: SyntheticTurn, status: TurnLifecycleObservation['status'], delivery: TurnLifecycleObservation['delivery'] = 'live') {
  const observation: TurnLifecycleObservation = { ...turn, status, source: 'fixture', delivery,
    sourceEventId: `turn-event-v1-${hash(`${turn.turnId}:${status}`)}`, occurredAt: new Date().toISOString() };
  await emit(request, 'agent.turn.observed', turn.agentId, { observation });
}
async function setLive(request: APIRequestContext) {
  const snapshot = await office(request);
  for (const action of ['reset', 'start', 'skip']) {
    const response = await request.post(`/api/presentation/${action}`, { headers: { 'X-Office-Token': snapshot.controlToken! } });
    expect(response.ok()).toBeTruthy();
  }
}
function handoff(): OfficeHandoff {
  const handoffId = `synthetic-${randomUUID()}`;
  return { handoffId, fromAgentId: 'maple', toAgentId: 'willow', summary: 'Synthetic source handoff for lifecycle precedence',
    occurredAt: new Date().toISOString(), sourceItemId: `synthetic-item-${handoffId}` };
}

test.beforeEach(async ({ request }) => {
  const snapshot = await office(request);
  sourceTime = Math.max(sourceTime, Math.floor(Date.now() / 1000), ...snapshot.latestTurns?.map(turn => turn.startedAt ?? 0) ?? []);
  for (const agent of snapshot.agents.filter(agent => ['maple', 'willow'].includes(agent.agentId))) {
    for (const requestId of agent.pendingRequestIds) await emit(request, 'request.resolved', agent.agentId, { requestId, reason: 'Synthetic test reset' });
    await emit(request, 'agent.state.changed', agent.agentId, { runtimeState: 'working' });
  }
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Synthetic lifecycle browser fixture' } });
  parentTurn = newTurn('maple');
  childTurn = newTurn('willow');
  await observe(request, parentTurn, 'started', 'history');
  await observe(request, childTurn, 'started', 'history');
  await setLive(request);
});

test.afterEach(async ({ request }) => {
  // Leave the shared fixture present for the other browser files. These are
  // synthetic authoritative baselines, never actions against real Codex chats.
  await observe(request, newTurn('maple'), 'started', 'history');
  await observe(request, newTurn('willow'), 'started', 'history');
});

test('a successful current turn leaves, and new work returns without removing its child or source identity', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await page.goto('/');
  const parent = page.getByTestId('scene-agent-maple');
  const child = page.getByTestId('scene-agent-willow');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect.poll(() => page.locator('.office-map-artwork').evaluate(image => (image as HTMLImageElement).complete)).toBeTruthy();
  const viewport = page.getByTestId('office-map-viewport');
  const cameraLeft = await viewport.evaluate(element => { element.scrollLeft = 150; return element.scrollLeft; });
  expect(cameraLeft).toBeGreaterThan(0);
  await observe(request, parentTurn, 'succeeded');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'leaving');
  await expect(parent).toHaveAttribute('data-motion', 'leaving');
  await expect(parent).toHaveCount(0);
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(cameraLeft);
  await expect(child).toHaveAttribute('data-lifecycle-phase', 'present');
  expect((await office(request)).agents.find(agent => agent.agentId === 'maple')?.runtimeState).toBe('working');

  await observe(request, newTurn('maple'), 'started');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'entering');
  await expect(parent).toHaveAttribute('data-motion', 'entering');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(child).toHaveAttribute('data-lifecycle-phase', 'present');
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(cameraLeft);
});

test('an observed failure plays the native failed row before disappearing', async ({ page, request }) => {
  await page.goto('/');
  const parent = page.getByTestId('scene-agent-maple');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await observe(request, parentTurn, 'failed');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'dying');
  await expect(parent).toHaveAttribute('data-animation', 'failed');
  await expect(parent).toHaveCount(0);
  const snapshot = await office(request);
  expect(snapshot.latestTurns?.find(turn => turn.agentId === 'maple')?.status).toBe('failed');
  expect(snapshot.agents.find(agent => agent.agentId === 'maple')?.runtimeState).toBe('working');
});

test('an interrupted turn sleeps in the office and new work wakes it in place', async ({ page, request }) => {
  await page.goto('/');
  const parent = page.getByTestId('scene-agent-maple');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await observe(request, parentTurn, 'interrupted');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'sleeping');
  await expect(parent).toHaveAttribute('data-animation', 'waiting');
  expect(await parent.evaluate(element => getComputedStyle(element, '::after').content)).toContain('z z');
  await expect(parent).toHaveAttribute('data-runtime-state', 'working');
  const sleepPoint = await parent.evaluate(element => ({ left: (element as HTMLElement).style.left, top: (element as HTMLElement).style.top }));

  await observe(request, newTurn('maple'), 'started');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(parent).toHaveAttribute('data-animation', '');
  expect(await parent.evaluate(element => ({ left: (element as HTMLElement).style.left, top: (element as HTMLElement).style.top }))).toEqual(sleepPoint);
});

test('a historical terminal snapshot establishes absence without replaying exit or death', async ({ page, request }) => {
  await observe(request, parentTurn, 'failed', 'history');
  await page.addInitScript(() => {
    const state = window as unknown as { syntheticLifecycleMotion: boolean };
    state.syntheticLifecycleMotion = false;
    new MutationObserver(() => {
      const pet = document.querySelector('[data-testid="scene-agent-maple"]');
      if (pet && ['leaving', 'dying', 'entering'].includes(pet.getAttribute('data-lifecycle-phase') ?? '')) state.syntheticLifecycleMotion = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-lifecycle-phase'] });
  });
  await page.goto('/');
  await expect(page.getByTestId('scene-agent-willow')).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(page.getByTestId('scene-agent-maple')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticLifecycleMotion: boolean }).syntheticLifecycleMotion)).toBe(false);
  await page.reload();
  await expect(page.getByTestId('scene-agent-willow')).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(page.getByTestId('scene-agent-maple')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticLifecycleMotion: boolean }).syntheticLifecycleMotion)).toBe(false);
});

test('lifecycle cancels a real meeting and releases the surviving child', async ({ page, request }) => {
  await page.goto('/');
  const scene = page.getByTestId('office-scene');
  const parent = page.getByTestId('scene-agent-maple');
  const child = page.getByTestId('scene-agent-willow');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  const observed = handoff();
  await emit(request, 'handoff.observed', 'maple', { handoff: observed });
  await expect(scene).toHaveAttribute('data-meeting', observed.handoffId);
  await expect(child).toHaveAttribute('data-location', 'water-cooler');

  await observe(request, parentTurn, 'interrupted');
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'sleeping');
  await expect(child).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(child).toHaveAttribute('data-meeting-participant', 'false');
  await expect(child).not.toHaveAttribute('data-location', 'water-cooler');

  await observe(request, newTurn('maple'), 'started');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  const next = handoff();
  await emit(request, 'handoff.observed', 'maple', { handoff: next });
  await expect(scene).toHaveAttribute('data-meeting', next.handoffId);
});

test('decorative check-ins wave without source messages and yield immediately to a real handoff', async ({ page, request }) => {
  const clockTime = new Date('2026-11-01T12:00:00Z');
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  const posts: string[] = [];
  page.on('request', value => { if (value.method() === 'POST') posts.push(value.url()); });
  await page.goto('/');
  const scene = page.getByTestId('office-scene');
  const parent = page.getByTestId('scene-agent-maple');
  const child = page.getByTestId('scene-agent-willow');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(child).toHaveAttribute('data-lifecycle-phase', 'present');
  const before = await office(request);
  await page.clock.fastForward(45_100);
  await expect(scene).toHaveAttribute('data-check-in', 'active');
  await expect(parent).toHaveAttribute('data-animation', 'waving');
  await expect(child).toHaveAttribute('data-animation', 'waving');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  const after = await office(request);
  expect(after.recentHandoffs).toEqual(before.recentHandoffs);
  expect(after.pendingRequests).toEqual(before.pendingRequests);
  expect(after.agents).toEqual(before.agents);
  expect(posts).toEqual([]);

  const observed = handoff();
  await emit(request, 'handoff.observed', 'maple', { handoff: observed });
  await expect(scene).toHaveAttribute('data-check-in', '');
  await expect(scene).toHaveAttribute('data-meeting', observed.handoffId);
  await expect(parent).not.toHaveAttribute('data-animation', 'waving');
  await expect(child).not.toHaveAttribute('data-animation', 'waving');
});

test('verified active turns allow check-ins and truthful labels while raw runtime stays unknown', async ({ page, request }) => {
  // The latest verified started turns were seeded by beforeEach. Metadata can
  // still report unknown without erasing that independent turn evidence.
  for (const agentId of ['maple', 'willow']) await emit(request, 'agent.state.changed', agentId, { runtimeState: 'unknown' });
  const clockTime = new Date('2026-11-01T12:00:00Z');
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  await page.goto('/');
  const scene = page.getByTestId('office-scene');
  const parent = page.getByTestId('scene-agent-maple');
  const child = page.getByTestId('scene-agent-willow');
  await expect(parent).toHaveAttribute('data-lifecycle-phase', 'present');
  await expect(child).toHaveAttribute('data-lifecycle-phase', 'present');
  const before = await office(request);
  for (const agentId of ['maple', 'willow']) {
    expect(before.agents.find(agent => agent.agentId === agentId)?.runtimeState).toBe('unknown');
    expect(before.latestTurns?.find(turn => turn.agentId === agentId)?.status).toBe('started');
  }

  await parent.hover();
  await expect(page.getByRole('tooltip')).toContainText('Turn in progress');
  await parent.click();
  await expect(page.getByTestId('agent-inspector').getByText('Turn in progress', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close pet details' }).click();
  await page.clock.fastForward(45_100);
  await expect(scene).toHaveAttribute('data-check-in', 'active');
  await expect(parent).toHaveAttribute('data-animation', 'waving');
  await expect(child).toHaveAttribute('data-animation', 'waving');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  const after = await office(request);
  expect(after.agents).toEqual(before.agents);
  expect(after.latestTurns).toEqual(before.latestTurns);
  expect(after.recentHandoffs).toEqual(before.recentHandoffs);
});
