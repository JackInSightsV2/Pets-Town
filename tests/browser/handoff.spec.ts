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
async function live(page: Page) {
  await page.getByTestId('start-day').click();
  await page.getByTestId('skip-standup').click();
  await expect(page.getByTestId('presentation-state')).toHaveText('Live view');
}

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get('/api/office')).json() as OfficeSnapshot;
  for (const id of ['maple', 'willow']) await emit(request, 'agent.state.changed', id, { runtimeState: 'working' });
  await emit(request, 'connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Explicit handoff browser fixture' } });
  await request.post('/api/presentation/reset', { headers: { 'X-Office-Token': snapshot.controlToken! } });
});

test('fresh SSE handoff moves the pair, shows its summary, returns home and ignores history/replay', async ({ page, request }) => {
  const historic = handoff('Historical fixture exchange');
  await emit(request, 'handoff.observed', 'maple', { handoff: historic });
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Show subagents' }).check();
  await live(page);
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
  await page.screenshot({ path: 'docs/evidence/track-c-handoff.png', fullPage: true });
  await expect(scene).toHaveAttribute('data-meeting-phase', 'returning');
  await expect(maple).toHaveAttribute('data-location', 'home');
  await expect(willow).toHaveAttribute('data-location', 'home');
  await expect(scene).toHaveAttribute('data-meeting', '');
  expect(await maple.getAttribute('style')).toEqual(home[0]);
  expect(await willow.getAttribute('style')).toEqual(home[1]);

  // A distinct transport event replaying the same source handoff must not animate twice.
  await emit(request, 'handoff.observed', 'maple', { handoff: fresh });
  await emit(request, 'agent.state.changed', 'maple', { runtimeState: 'idle' });
  await expect(page.getByTestId('agent-button-maple')).toContainText(/idle/i);
  await expect(scene).toHaveAttribute('data-meeting', '');
  await page.reload();
  await expect(page.getByTestId('agent-button-maple')).toBeVisible();
  await expect(page.getByTestId('office-scene')).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
});

test('reset cancels a meeting and hiding a participant never reveals it', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Show subagents' }).check();
  await live(page);
  const scene = page.getByTestId('office-scene');
  const first = handoff('Fixture exchange cancelled by scene reset');
  await emit(request, 'handoff.observed', 'maple', { handoff: first });
  await expect(scene).toHaveAttribute('data-meeting', first.handoffId);
  await page.getByTestId('reset-scene').click();
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
  await live(page);
  await expect(scene).toHaveAttribute('data-meeting', '');

  const second = handoff('Fixture exchange with a subsequently hidden participant');
  await emit(request, 'handoff.observed', 'maple', { handoff: second });
  await expect(scene).toHaveAttribute('data-meeting', second.handoffId);
  await page.getByRole('checkbox', { name: 'Show subagents' }).uncheck();
  await expect(scene).toHaveAttribute('data-meeting', '');
  await expect(page.getByTestId('scene-agent-willow')).toHaveCount(0);
  await expect(page.getByTestId('agent-button-willow')).toHaveCount(0);
  await expect(page.getByTestId('hidden-handoff-count')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Show subagents' })).not.toBeChecked();
  await expect(page.getByTestId('handoff-summary')).toHaveCount(0);
});
