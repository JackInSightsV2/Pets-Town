import { test, expect } from '@playwright/test';
import type { OfficeSnapshot } from '../../src/shared/contract.js';

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`office preserves logical scale at ${size.width}×${size.height} and retains overflow access`, async ({ page }) => {
    await page.setViewportSize(size);
    // Browser-only fixture: do not change the source roster or presentation.
    await page.route('**/api/office', async route => {
      const response = await route.fetch();
      const snapshot = await response.json() as OfficeSnapshot;
      const original = snapshot.agents.find(agent => agent.petAssetId)!;
      snapshot.presentation = { state: 'live', canSkip: false };
      delete snapshot.controlToken;
      // The synthetic camera roster has no source-correlated turn evidence.
      delete snapshot.latestTurns;
      snapshot.agents = Array.from({ length: 24 }, (_, index) => ({ ...original,
        agentId: `camera-${index}`, parentAgentId: null, displayName: `Camera pet ${index}`,
        runtimeState: index === 0 ? 'idle' : 'working', pendingRequestIds: [], recentActivity: [],
      }));
      snapshot.projects = snapshot.projects.filter(project => project.projectId === original.projectId);
      await route.fulfill({ response, json: snapshot });
    });
    await page.route('**/api/events?*', route => route.fulfill({ status: 204 }));
    await page.goto('/?view=2d');
    const first = page.getByTestId('scene-agent-camera-0');
    await expect(first).toBeVisible();
    await expect(page.getByTestId('office-map-surface')).toHaveCSS('transform', 'none');
    await expect(first.locator('.native-pet')).toHaveCSS('width', '54px');
    const home = [await first.getAttribute('data-home-left'), await first.getAttribute('data-home-top')];
    await first.click();
    const popup = page.getByTestId('agent-inspector');
    await expect(popup).toBeVisible();
    const before = (await popup.boundingBox())!;
    expect(before.x).toBeGreaterThanOrEqual(0);
    expect(before.x + before.width).toBeLessThanOrEqual(size.width);
    expect(before.y + before.height).toBeLessThanOrEqual(size.height);
    const delta = await page.getByTestId('office-map-viewport').evaluate(element => {
      const previous = element.scrollTop;
      element.scrollTop += 40;
      return element.scrollTop - previous;
    });
    await expect.poll(async () => (await popup.boundingBox())!.y).toBeCloseTo(before.y - delta, 0);
    await page.setViewportSize({ width: size.width + 50, height: size.height + 50 });
    await expect(page.getByTestId('office-map-surface')).toHaveCSS('transform', 'none');
    expect([await first.getAttribute('data-home-left'), await first.getAttribute('data-home-top')]).toEqual(home);
    await page.keyboard.press('Escape');
    const last = page.getByTestId('scene-agent-camera-23');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 0.999 });
    await last.click();
    await expect(page.getByTestId('selected-agent-name')).toHaveText('Camera pet 23');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBeFalsy();
  });
}
