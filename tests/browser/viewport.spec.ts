import { test, expect } from '@playwright/test';
import type { OfficeSnapshot } from '../../src/shared/contract.js';

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`office camera fills ${size.width}×${size.height}, reveals its first pet and retains overflow access`, async ({ page }) => {
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
    await page.goto('/');
    const first = page.getByTestId('scene-agent-camera-0');
    await expect(first).toBeVisible();
    await expect.poll(async () => page.locator('.office-map-artwork').evaluate(image => {
      const artwork = image as HTMLImageElement;
      const bounds = artwork.getBoundingClientRect();
      return artwork.complete && bounds.width >= innerWidth - 1
        && bounds.width * artwork.naturalHeight / artwork.naturalWidth >= innerHeight - 1;
    })).toBeTruthy();
    // Actions such as hover/click auto-scroll, so check the initial framing first.
    await expect(first).toBeInViewport({ ratio: 0.999 });
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
    await expect(first).toBeInViewport({ ratio: 0.999 });
    await expect.poll(async () => {
      const petBounds = (await first.boundingBox())!;
      const popupBounds = (await popup.boundingBox())!;
      return Math.abs(petBounds.x + petBounds.width / 2 - popupBounds.x - popupBounds.width / 2);
    }).toBeLessThan(1);
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
