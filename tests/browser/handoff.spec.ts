import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { OfficeHandoff, OfficeSnapshot } from '../../src/shared/contract.js';

async function emit(request: APIRequestContext, type: string, agentId: string | null, data: unknown) {
  const response = await request.post('http://127.0.0.1:5418/events', { data: { type, agentId, data } });
  expect(response.ok()).toBeTruthy();
}
function handoff(summary: string): OfficeHandoff {
  const id = randomUUID();
  return { handoffId: id, fromAgentId: 'maple', toAgentId: 'willow', summary, occurredAt: new Date().toISOString(), sourceItemId: `source-${id}` };
}
async function live(page: Page, request: APIRequestContext) {
  await expect(page.getByTestId('office-scene')).toHaveAttribute('data-presentation', 'live');
  await expect.poll(async () => ((await (await request.get('/api/office')).json()) as OfficeSnapshot).presentation.state).toBe('live');
}

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  for (const id of ['maple', 'willow']) await emit(request, 'agent.state.changed', id, { runtimeState: 'working' });
  await emit(request, 'request.resolved', 'willow', { requestId: 'missing-details', reason: 'Handoff fixture starts without unresolved attention' });
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Explicit handoff browser fixture' } });
  await request.post('/api/presentation/reset', { headers: { 'X-Office-Token': snapshot.controlToken! } });
});

test('fresh SSE handoff moves the pair, shows its summary, returns home and ignores history/replay', async ({ page, request }) => {
  const historic = handoff('Historical fixture exchange');
  await emit(request, 'handoff.observed', 'maple', { handoff: historic });
  await page.goto('/?view=2d');
  await live(page, request);
  const scene = page.getByTestId('office-scene');
  await expect(scene).toHaveAttribute('data-meeting', '');
  const maple = page.getByTestId('scene-agent-maple');
  const willow = page.getByTestId('scene-agent-willow');
  const home = await Promise.all([maple.getAttribute('style'), willow.getAttribute('style')]);
  const fresh = handoff('Fixture: pass the observed design notes to Willow');
  await emit(request, 'handoff.observed', 'maple', { handoff: fresh });
  await expect(scene).toHaveAttribute('data-meeting', fresh.handoffId);
  await expect(maple).toHaveAttribute('data-location', 'water-cooler');
  await expect(willow).toHaveAttribute('data-location', 'water-cooler');
  expect(await maple.getAttribute('style')).not.toEqual(home[0]);
  expect(await willow.getAttribute('style')).not.toEqual(home[1]);
  await expect(page.getByTestId('handoff-summary')).toContainText(fresh.summary);
  await page.screenshot({ path: 'test-results/track-c-handoff.png', fullPage: true });
  await expect(scene).toHaveAttribute('data-meeting-phase', 'returning');
  await expect(maple).toHaveAttribute('data-location', 'home');
  await expect(willow).toHaveAttribute('data-location', 'home');
  await expect(scene).toHaveAttribute('data-meeting', '');
  expect(await maple.getAttribute('style')).toEqual(home[0]);
  expect(await willow.getAttribute('style')).toEqual(home[1]);

  // A distinct transport event replaying the same source handoff must not animate twice.
  await emit(request, 'handoff.observed', 'maple', { handoff: fresh });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'idle' });
  await expect(maple).toHaveAttribute('data-runtime-state', 'idle');
  await expect(scene).toHaveAttribute('data-meeting', '');
  await page.reload();
  await expect(page.getByTestId('scene-agent-maple')).toBeVisible();
  await expect(page.getByTestId('office-scene')).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
});

test('source disconnect cancels a meeting and reconnect does not replay it', async ({ page, request }) => {
  await page.goto('/?view=2d');
  await live(page, request);
  const scene = page.getByTestId('office-scene');
  const first = handoff('Fixture exchange interrupted by source disconnect');
  await emit(request, 'handoff.observed', 'maple', { handoff: first });
  await expect(scene).toHaveAttribute('data-meeting', first.handoffId);
  await emit(request, 'connection.changed', null, { connection: { status: 'disconnected', lastObservedAt: new Date().toISOString(), message: 'Fixture source disconnected' } });
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  await expect(page.getByTestId('scene-agent-maple')).toHaveAttribute('data-runtime-state', 'working');
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Fixture source restored' } });
  await page.reload();
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
});

test('backend reset and an observed participant failure cancel meetings', async ({ page, request }) => {
  await page.goto('/?view=2d');
  await live(page, request);
  const scene = page.getByTestId('office-scene');
  const first = handoff('Fixture exchange cancelled by scene reset');
  await emit(request, 'handoff.observed', 'maple', { handoff: first });
  await expect(scene).toHaveAttribute('data-meeting', first.handoffId);
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  await request.post('/api/presentation/reset', { headers: { 'X-Office-Token': snapshot.controlToken! } });
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  for (const action of ['start', 'skip']) await request.post(`/api/presentation/${action}`, { headers: { 'X-Office-Token': snapshot.controlToken! } });
  await live(page, request);
  await expect(scene).toHaveAttribute('data-meeting', '');

  const second = handoff('Fixture exchange with a subsequently hidden participant');
  await emit(request, 'handoff.observed', 'maple', { handoff: second });
  await expect(scene).toHaveAttribute('data-meeting', second.handoffId);
  await emit(request, 'agent.state.changed', 'willow', { runtimeState: 'error' });
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('scene-agent-willow')).toHaveAttribute('data-runtime-state', 'error');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
});
