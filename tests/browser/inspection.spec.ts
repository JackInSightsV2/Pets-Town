import { test, expect, type APIRequestContext } from '@playwright/test';
import type { OfficeSnapshot } from '../../src/shared/contract.js';

async function emit(request: APIRequestContext, type: string, agentId: string | null, data: unknown) {
  const response = await request.post('http://127.0.0.1:5418/events', { data: { type, agentId, data } });
  expect(response.ok()).toBeTruthy();
}
async function presentation(request: APIRequestContext, action: 'start' | 'skip' | 'reset') {
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  const response = await request.post(`/api/presentation/${action}`, { headers: { 'X-Office-Token': snapshot.controlToken! } });
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  for (const agent of snapshot.agents.filter(agent => ['maple', 'willow'].includes(agent.agentId))) {
    for (const requestId of agent.pendingRequestIds) await emit(request, 'request.resolved', agent.agentId, { requestId, reason: 'test reset' });
    await emit(request, 'agent.state.changed', agent.agentId, { runtimeState: agent.agentId === 'maple' ? 'working' : 'waiting-for-input' });
  }
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Explicit browser test fixture' } });
  await presentation(request, 'reset');
  await presentation(request, 'start');
  await presentation(request, 'skip');
});

test('pet popup preserves identity and exact request lifecycle through presentation changes', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?view=2d');
  const pet = page.getByTestId('scene-agent-maple');
  const attention = pet.getByLabel('Unresolved request');
  await pet.click();
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  await expect(page.getByTestId('agent-task')).toContainText('Inspect the current workspace');
  await expect(page.getByTestId('recent-activity')).toContainText('Reading the project design');
  const makeRequest = (requestId: string, prompt: string) => ({
    requestId, agentId: 'maple', kind: 'user-input', prompt, options: [], createdAt: new Date().toISOString(),
    responseCapability: { supported: false, reason: 'Response ownership is not verified' }, revision: '1',
  });
  await emit(request, 'request.opened', 'maple', { request: makeRequest('question-1', 'Which project should I inspect?') });
  await emit(request, 'request.opened', 'maple', { request: makeRequest('question-2', 'Which output format should I use?') });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'waiting-for-input' });
  await expect(page.getByTestId('request-question-1')).toBeVisible();
  await expect(attention).toHaveCount(1);
  await expect(page.getByTestId('reply-submit')).toHaveCount(0);
  await expect(page.getByTestId('open-chat')).toHaveCount(0);
  // Exercise presentation independence through the backend; the office has no controls.
  await presentation(request, 'reset');
  await presentation(request, 'start');
  await presentation(request, 'skip');
  await expect(page.getByTestId('request-question-1')).toBeVisible();
  await expect(attention).toHaveCount(1);
  await emit(request, 'request.resolved', 'maple', { requestId: 'question-1', reason: 'Answered in original Codex client' });
  await expect(page.getByTestId('request-question-1')).toHaveCount(0);
  await expect(page.getByTestId('request-question-2')).toBeVisible();
  await expect(attention).toHaveCount(1);
  await emit(request, 'request.resolved', 'maple', { requestId: 'question-2', reason: 'Answered in original Codex client' });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'working' });
  await expect(page.getByTestId('request-question-2')).toHaveCount(0);
  await expect(attention).toHaveCount(0);
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  expect(errors).toEqual([]);
});

test('a synthetic local-source snapshot links only the selected existing chat', async ({ page }) => {
  await page.route('**/api/office', async route => {
    const response = await route.fetch();
    const snapshot = await response.json() as OfficeSnapshot;
    // Synthetic source-mode switch verifies navigation identity, not live acceptance.
    snapshot.source = 'codex';
    // Prior browser cases can seed fixture turn evidence; that evidence must not
    // be relabelled as Codex merely to exercise the navigation link.
    delete snapshot.latestTurns;
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/?view=2d');
  await page.getByTestId('scene-agent-maple').click();
  await expect(page.getByTestId('open-chat')).toHaveAttribute('href', 'codex://threads/maple');
  await page.keyboard.press('Escape');
  await page.getByTestId('scene-agent-willow').click();
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Willow');
  await expect(page.getByTestId('open-chat')).toHaveAttribute('href', 'codex://threads/willow');
  await expect(page.getByTestId('reply-input')).toHaveCount(0);
});

test('automatic live presentation retries one startup failure and stays idempotent after refresh', async ({ page, request }) => {
  await presentation(request, 'reset');
  const before = await (await request.get('/api/office')).json() as OfficeSnapshot;
  let starts = 0;
  let skips = 0;
  await page.route('**/api/presentation/start', async route => {
    starts++;
    if (starts === 1) await route.fulfill({ status: 503, json: { error: 'Synthetic transient startup failure' } });
    else await route.continue();
  });
  await page.route('**/api/presentation/skip', async route => { skips++; await route.continue(); });
  await page.goto('/?view=2d');
  await expect.poll(async () => ((await (await request.get('/api/office')).json()) as OfficeSnapshot).presentation.state).toBe('live');
  expect(starts).toBe(2);
  expect(skips).toBe(1);
  const after = await (await request.get('/api/office')).json() as OfficeSnapshot;
  expect(after.agents.map(agent => [agent.agentId, agent.runtimeState])).toEqual(before.agents.map(agent => [agent.agentId, agent.runtimeState]));
  await page.reload();
  await page.getByTestId('scene-agent-maple').click();
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  expect(starts).toBe(2);
  expect(skips).toBe(1);
});

test('popup uses observed status and omits unavailable details through disconnect and recovery', async ({ page, request }) => {
  await page.goto('/?view=2d');
  const pet = page.getByTestId('scene-agent-willow');
  await pet.click();
  const popup = page.getByTestId('agent-inspector');
  await expect(popup).toContainText('Waiting for input');
  await expect(page.getByTestId('agent-task')).toHaveCount(0);
  await expect(page.getByTestId('recent-activity')).toHaveCount(0);
  await expect(popup).not.toContainText(/not available|unavailable|no recent|no outstanding/i);
  await emit(request, 'agent.state.changed', 'willow', { runtimeState: 'error' });
  await emit(request, 'connection.changed', null, { connection: { status: 'disconnected', lastObservedAt: new Date().toISOString(), message: 'Test bridge lost contact' } });
  await expect(pet).toHaveAttribute('data-runtime-state', 'error');
  await expect(popup).toContainText('Agent error');
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Willow');
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: null } });
  await emit(request, 'agent.state.changed', 'willow', { runtimeState: 'waiting-for-input' });
  await expect(pet).toHaveAttribute('data-runtime-state', 'waiting-for-input');
  await expect(popup).toContainText('Waiting for input');
});

test('fullscreen office uses hover details and a viewport-bounded popup', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=2d');
  await expect(page.locator('header, footer, .agent-roster, .roster-panel, .office-toolbar, .office-project-area, .office-project-label, .scene-floor-tag, .scene-caption')).toHaveCount(0);
  await expect(page.getByTestId('agent-inspector')).toHaveCount(0);
  const pet = page.getByTestId('scene-agent-maple');
  await pet.hover();
  await expect(page.getByRole('tooltip')).toContainText('Maple');
  await expect(page.getByRole('tooltip')).toContainText('Working');
  await pet.click();
  const popup = page.getByTestId('agent-inspector');
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/office-mobile-popup.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBeFalsy();
  await page.context().setOffline(true);
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  await page.context().setOffline(false);
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'idle' });
  await expect(pet).toHaveAttribute('data-runtime-state', 'idle');
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await page.screenshot({ path: 'test-results/office-mobile.png', fullPage: true });
});
