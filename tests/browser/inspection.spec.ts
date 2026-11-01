import { test, expect, type APIRequestContext } from '@playwright/test';
import type { OfficeSnapshot } from '../../src/shared/contract.js';

async function emit(request: APIRequestContext, type: string, agentId: string | null, data: unknown) {
  const result = await request.post('http://127.0.0.1:5418/events', { data: { type, agentId, data } });
  expect(result.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  for (const agent of snapshot.agents) {
    for (const requestId of agent.pendingRequestIds) await emit(request, 'request.resolved', agent.agentId, { requestId, reason: 'test reset' });
    await emit(request, 'agent.state.changed', agent.agentId, { runtimeState: agent.agentId === 'maple' ? 'working' : 'waiting-for-input' });
  }
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Explicit browser test fixture' } });
  await request.post('/api/presentation/reset', { headers: { 'X-Office-Token': snapshot.controlToken! } });
});

test('real transport preserves selection and exact request lifecycle through presentation changes', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('fixture-banner')).toBeVisible();
  await page.getByTestId('agent-button-maple').click();
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  await expect(page.getByTestId('agent-task')).toContainText('Inspect the current workspace');
  const makeRequest = (requestId: string, prompt: string) => ({
    requestId, agentId: 'maple', kind: 'user-input', prompt, options: [], createdAt: new Date().toISOString(),
    responseCapability: { supported: false, reason: 'Response ownership is not verified' }, revision: '1',
  });
  await emit(request, 'request.opened', 'maple', { request: makeRequest('question-1', 'Which project should I inspect?') });
  await emit(request, 'request.opened', 'maple', { request: makeRequest('question-2', 'Which output format should I use?') });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'waiting-for-input' });
  await expect(page.getByTestId('request-question-1')).toBeVisible();
  await expect(page.getByTestId('attention-maple')).toBeVisible();
  await expect(page.getByTestId('reply-submit').first()).toBeDisabled();
  await page.getByTestId('start-day').click();
  await page.getByTestId('skip-standup').click();
  await page.getByTestId('reset-scene').click();
  await expect(page.getByTestId('request-question-1')).toBeVisible();
  await expect(page.getByTestId('attention-maple')).toBeVisible();
  await emit(request, 'request.resolved', 'maple', { requestId: 'question-1', reason: 'Answered in original Codex client' });
  await expect(page.getByTestId('request-question-1')).toHaveCount(0);
  await expect(page.getByTestId('request-question-2')).toBeVisible();
  await expect(page.getByTestId('attention-maple')).toBeVisible();
  await emit(request, 'request.resolved', 'maple', { requestId: 'question-2', reason: 'Answered in original Codex client' });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'working' });
  await expect(page.getByTestId('request-question-2')).toHaveCount(0);
  await expect(page.getByTestId('attention-maple')).toHaveCount(0);
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Maple');
  await page.screenshot({ path: 'test-results/office-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('waiting details, source disconnect and runtime error remain distinguishable', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('agent-button-willow').click();
  await expect(page.getByTestId('waiting-details-unavailable')).toBeVisible();
  await emit(request, 'agent.state.changed', 'willow', { runtimeState: 'error' });
  await emit(request, 'connection.changed', null, { connection: { status: 'disconnected', lastObservedAt: new Date().toISOString(), message: 'Test bridge lost contact' } });
  await expect(page.getByTestId('connection-status')).toContainText(/disconnected|lost|offline/i);
  await expect(page.getByTestId('agent-inspector')).toContainText(/error|failed/i);
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Willow');
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: null } });
  await expect(page.getByTestId('connection-status')).not.toContainText(/disconnected|lost|offline/i);
  await expect(page.getByTestId('agent-inspector')).toContainText(/error|failed/i);
});

test('scene selection seam, responsive layout and connection recovery work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('agent-button-maple').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('petstown:select-agent', { detail: { agentId: 'willow' } })));
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Willow');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBeFalsy();
  await page.context().setOffline(true);
  await expect(page.getByTestId('connection-status')).toContainText(/reconnect|disconnected|lost|offline/i);
  await page.context().setOffline(false);
  await expect(page.getByTestId('connection-status')).not.toContainText(/reconnect|disconnected|lost|offline/i);
  await expect(page.getByTestId('selected-agent-name')).toHaveText('Willow');
  await page.screenshot({ path: 'test-results/office-mobile.png', fullPage: true });
});
