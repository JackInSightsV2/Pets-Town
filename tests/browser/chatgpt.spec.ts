import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { snapshot, agent } from '../../src/client/test-helpers';
import { builtInPets, officialPets } from '../../src/shared/pets';
import type { OfficeView } from '../../src/chatgpt/types';

// This is a protocol simulator, not evidence of an installed ChatGPT integration.
function fixture(): OfficeView {
  const data = snapshot();
  delete data.controlToken;
  data.petAssets = structuredClone(builtInPets);
  data.presentation = { state: 'live', canSkip: false };
  data.agents = [
    { ...agent('maple'), displayName: 'Maple', task: 'Inspect the landing page', petAssetId: 'codex' },
    { ...agent('willow'), displayName: 'Willow', task: 'Review the navigation', petAssetId: 'dewey' },
  ];
  data.capabilities.observeAgents = { supported: true, reason: null };
  return { snapshot: data, scopeId: 'test-scope', selectedAgentId: null, projectId: null };
}
async function mount(page: Page, modes = ['inline', 'fullscreen', 'pip']) {
  const html = await readFile('dist-chatgpt/office.html', 'utf8');
  const result = { content: [], _meta: { office: fixture() } };
  const hostHtml = `<!doctype html><html><body style="margin:0"><iframe title="PetsTown" src="https://petstown-ui.test/" style="border:0;width:100%;height:950px"></iframe><script>
    window.hostResult = ${JSON.stringify(result)};
    window.calls = []; window.contexts = []; window.messages = [];
    window.rejectRefresh = false; window.deferRefresh = false; window.pending = [];
    const frame = document.querySelector('iframe');
    window.notify = (method, params) => frame.contentWindow.postMessage({jsonrpc:'2.0',method,params}, '*');
    window.addEventListener('message', event => {
      if(event.source !== frame.contentWindow) return;
      const message=event.data;
      if(!message || message.jsonrpc !== '2.0') return;
      const reply = result => event.source.postMessage({jsonrpc:'2.0',id:message.id,result}, '*');
      switch(message.method) {
        case 'ui/initialize': reply({protocolVersion:message.params.protocolVersion,hostInfo:{name:'PetsTown test host',version:'1'},hostCapabilities:{serverTools:{},updateModelContext:{text:{}},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:${JSON.stringify(modes)}}}); break;
        case 'ui/notifications/initialized': window.notify('ui/notifications/tool-result',window.hostResult); break;
        case 'tools/call': window.calls.push(message.params); if(window.deferRefresh) { const captured=structuredClone(window.hostResult); window.pending.push(() => reply(captured)); } else reply(window.rejectRefresh ? {isError:true,content:[{type:'text',text:'Unavailable'}]} : window.hostResult); break;
        case 'ui/update-model-context': window.contexts.push(message.params); reply({}); break;
        case 'ui/message': window.messages.push(message.params); reply({}); break;
        case 'ui/request-display-mode': reply({mode:message.params.mode}); window.notify('ui/notifications/host-context-changed',{displayMode:message.params.mode}); break;
        default: if(message.id !== undefined) reply({});
      }
    });
  </script></body></html>`;
  await page.route('https://petstown-host.test/', route => route.fulfill({ contentType: 'text/html', body: hostHtml }));
  await page.route('https://petstown-ui.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://cdn.openai.com/**', async route => {
    const pet = officialPets.find(item => item.imageUrl === route.request().url());
    if (!pet) return route.abort();
    try { await route.fulfill({ contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(`.cache/pets/${pet.assetId}.webp`) }); }
    catch { await route.abort(); }
  });
  await page.goto('https://petstown-host.test/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByTestId('embedded-agent-maple')).toBeVisible();
  return frame;
}

test('embedded selection, composer context and display modes use the host bridge', async ({ page }) => {
  const errors: string[] = [], urls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => urls.push(request.url()));
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-maple').click();
  await expect(frame.getByTestId('embedded-details')).toContainText('Inspect the landing page');
  await expect.poll(() => page.evaluate(() => {
    const contexts = (window as unknown as { contexts: { content: { text: string }[] }[] }).contexts;
    return JSON.parse(contexts.at(-1)?.content[0].text ?? '{}').selection?.agentId;
  })).toBe('maple');
  await frame.getByRole('button', { name: 'Ask about this pet' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.length)).toBe(1);
  await frame.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(frame.getByTestId('embedded-office')).toHaveClass(/mode-fullscreen/);
  await expect(frame.getByTestId('embedded-agent-maple')).toHaveAttribute('aria-pressed', 'true');
  await frame.getByRole('button', { name: 'Keep visible' }).click();
  await expect(frame.getByTestId('embedded-office')).toHaveClass(/mode-pip/);
  await frame.getByRole('button', { name: 'Back to chat' }).click();
  await expect(frame.getByTestId('embedded-office')).toHaveClass(/mode-inline/);
  expect(urls.some(url => /127\.0\.0\.1|localhost|\/api\/room\//.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('refresh preserves selection, reports failures, and recovers from source changes', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-willow').click();
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    host.hostResult._meta.office.snapshot.lastSeq++;
    host.hostResult._meta.office.snapshot.agents[1].task = 'Updated real-source-shaped observation';
  });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(frame.getByTestId('embedded-details')).toContainText('Updated real-source-shaped observation');
  await expect(frame.getByTestId('embedded-agent-willow')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { rejectRefresh: boolean }).rejectRefresh = true; });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(frame.getByText('Could not refresh this office.', { exact: false })).toBeVisible();
  await expect(frame.getByTestId('embedded-details')).toContainText('Last observed');
  await page.evaluate(() => { (window as unknown as { rejectRefresh: boolean }).rejectRefresh = false; });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(frame.getByText('Could not refresh this office.', { exact: false })).toHaveCount(0);
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.scopeId = 'new-scope';
    host.hostResult._meta.office.snapshot.bridgeEpoch = 'new-epoch';
    host.notify('ui/notifications/tool-result', host.hostResult);
  });
  await expect(frame.getByTestId('embedded-details')).toHaveCount(0);
});

test('narrow dark inline view has keyboard selection and honest mode fallback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const frame = await mount(page, ['inline']);
  await page.evaluate(() => {
    const host = window as unknown as { notify(method: string, params: unknown): void };
    host.notify('ui/notifications/host-context-changed', { theme: 'dark', safeAreaInsets: { top: 8, right: 0, bottom: 20, left: 0 } });
  });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.getByRole('button', { name: 'Expand', exact: true })).toHaveCount(0);
  await expect(frame.getByText('This host supports the inline office view.')).toBeVisible();
  await frame.getByTestId('embedded-agent-maple').focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByTestId('embedded-details')).toContainText('Read-only');
  await page.keyboard.press('Escape');
  await expect(frame.getByTestId('embedded-details')).toHaveCount(0);
  const overflow = await frame.locator('body').evaluate(body => body.scrollWidth > body.clientWidth);
  expect(overflow).toBe(false);
  await frame.getByTestId('embedded-office').screenshot({ path: '/tmp/petstown-embedded-inline.png' });
});


test('a disappeared selected agent clears selection without blocking refresh', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-maple').click();
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    host.hostResult._meta.office.snapshot.lastSeq++;
    host.hostResult._meta.office.snapshot.agents = host.hostResult._meta.office.snapshot.agents.filter(agent => agent.agentId !== 'maple');
  });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(frame.getByTestId('embedded-agent-maple')).toHaveCount(0);
  await expect(frame.getByTestId('embedded-details')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const host = window as unknown as { contexts: { content: { text: string }[] }[]; calls: { arguments: Record<string, unknown> }[] };
    return { selection: JSON.parse(host.contexts.at(-1)?.content[0].text ?? '{}').selection, agentId: host.calls.at(-1)?.arguments.agentId ?? null };
  })).toEqual({ selection: null, agentId: null });
});

test('late refresh from a prior scope cannot replace the current office or model context', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-maple').click();
  await page.evaluate(() => { (window as unknown as { deferRefresh: boolean }).deferRefresh = true; });
  // Capture the next automatic poll; clicking can wait behind that in-flight request.
  await expect.poll(() => page.evaluate(() => (window as unknown as { pending: unknown[] }).pending.length)).toBe(1);
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.scopeId = 'new-scope';
    host.hostResult._meta.office.snapshot.bridgeEpoch = 'new-epoch';
    host.hostResult._meta.office.snapshot.agents = [host.hostResult._meta.office.snapshot.agents[1]];
    host.hostResult._meta.office.selectedAgentId = 'willow';
    host.notify('ui/notifications/tool-result', host.hostResult);
  });
  await expect(frame.getByTestId('embedded-details')).toContainText('Willow');
  await page.evaluate(() => { (window as unknown as { pending: (() => void)[] }).pending.shift()?.(); });
  await expect(frame.getByTestId('embedded-agent-maple')).toHaveCount(0);
  await expect(frame.getByTestId('embedded-details')).toContainText('Willow');
  await expect.poll(() => page.evaluate(() => {
    const contexts = (window as unknown as { contexts: { content: { text: string }[] }[] }).contexts.map(item => JSON.parse(item.content[0].text));
    return { latest: contexts.at(-1)?.selection?.agentId, mixed: contexts.some(item => item.scopeId === 'new-scope' && item.selection?.agentId === 'maple') };
  })).toEqual({ latest: 'willow', mixed: false });
});


test('a new conversational selection wins over an older same-scope refresh', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-maple').click();
  await page.evaluate(() => { (window as unknown as { deferRefresh: boolean }).deferRefresh = true; });
  // Capture the next automatic poll; clicking can wait behind that in-flight request.
  await expect.poll(() => page.evaluate(() => (window as unknown as { pending: unknown[] }).pending.length)).toBe(1);
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.selectedAgentId = 'willow';
    host.notify('ui/notifications/tool-result', host.hostResult);
  });
  await expect(frame.getByTestId('embedded-details')).toContainText('Willow');
  await page.evaluate(() => { (window as unknown as { pending: (() => void)[] }).pending.shift()?.(); });
  await expect(frame.getByTestId('embedded-details')).toContainText('Willow');
});

test('embedded 3D venue preserves role sizes and its canvas across refresh and display modes', async ({ page }) => {
  const frame = await mount(page);
  await expect(frame.getByTestId('office-scene')).toHaveAttribute('data-renderer', 'three');
  const canvas = frame.locator('.venue-render canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate(element => element.setAttribute('data-instance', 'original'));
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.snapshot.agents[1].parentAgentId = 'maple';
    host.notify('ui/notifications/tool-result', host.hostResult);
  });
  for (const [id, width] of [['maple', '0.81'], ['willow', '0.54']] as const) {
    const pet = frame.getByTestId(`scene-agent-${id}`);
    await expect(pet).toHaveAttribute('data-pet-width', width);
    await expect(pet).toHaveAttribute('data-pet-load', 'loaded');
    await expect.poll(() => pet.evaluate(element => {
      const pet = element.getBoundingClientRect(), scene = element.closest('.three-office')!.getBoundingClientRect();
      return pet.left >= scene.left && pet.top >= scene.top && pet.right <= scene.right && pet.bottom <= scene.bottom;
    })).toBe(true);
  }

  const before = await canvas.boundingBox();
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(canvas).toHaveAttribute('data-instance', 'original');
  expect(await canvas.boundingBox()).toEqual(before);
  await frame.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-instance', 'original');
  await expect(canvas).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Top view', exact: true })).toBeVisible();
  await frame.getByTestId('embedded-office').screenshot({ path: '/tmp/petstown-embedded-3d.png' });
});

test('ordered refresh updates live state without replacing the embedded layout or selection', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('embedded-agent-maple').click();
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    const view = host.hostResult._meta.office;
    const updated = { ...view.snapshot.agents[0], task: 'Delivered by the ordered event stream' };
    view.snapshot.lastSeq = 1;
    view.refresh = { mode: 'events', events: [{ protocolVersion: 1, bridgeEpoch: view.snapshot.bridgeEpoch,
      seq: 1, eventId: 'update-maple', occurredAt: '2026-11-01T13:00:01Z', source: view.snapshot.source,
      agentId: 'maple', type: 'agent.upserted', data: { agent: updated } }] };
  });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(frame.getByTestId('embedded-details')).toContainText('Delivered by the ordered event stream');
  await expect(frame.getByTestId('embedded-agent-maple')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as unknown as { calls: { arguments: { cursor?: { lastSeq: number } } }[] }).calls;
    return calls.at(-1)?.arguments.cursor?.lastSeq;
  })).toBe(0);
  await expect(frame.getByTestId('office-scene')).toHaveAttribute('data-renderer', 'three');
  await expect(frame.locator('.venue-render canvas')).toBeVisible();
});

test('eight demo pets load, rotate local activities, and never enter real observation context', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requestedAssets: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://cdn.openai.com/')) requestedAssets.push(request.url()); });
  const frame = await mount(page);
  await expect(frame.getByTestId('demo-badge')).toHaveText('Demo · 8 simulated pets');
  const demos = frame.locator('.venue-pet-label[data-demo="true"]');
  await expect(demos).toHaveCount(8);
  await expect(frame.locator('.venue-pet-label[data-demo="true"][data-pet-load="loaded"]')).toHaveCount(8);
  const demoIds = await demos.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
  expect(new Set(demoIds).size).toBe(8);
  for (const pet of officialPets.filter(pet => pet.assetId !== 'codex')) expect(requestedAssets).toContain(pet.imageUrl);

  await frame.getByTestId('embedded-agent-maple').click();
  await expect(frame.getByTestId('embedded-details')).toBeVisible();
  const dewey = frame.getByTestId('scene-agent-petstown-demo:dewey');
  await dewey.click();
  await expect(frame.getByTestId('demo-details')).toContainText('Simulated teammate · no real work is running');
  await expect(frame.getByTestId('embedded-details')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const contexts = (window as unknown as { contexts: { content: { text: string }[] }[] }).contexts;
    return JSON.parse(contexts.at(-1)?.content[0].text ?? '{}').selection;
  })).toBeNull();
  const activity = await frame.getByTestId('demo-details').locator('p').innerText();
  const position = await dewey.evaluate(element => (element as HTMLElement).style.transform);
  await expect(frame.getByTestId('demo-details').locator('p')).not.toHaveText(activity, { timeout: 10_000 });
  await expect.poll(() => dewey.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(position);
  const bridge = await page.evaluate(() => {
    const host = window as unknown as { contexts: unknown[]; calls: { name: string; arguments: unknown }[]; messages: unknown[] };
    return { contexts: host.contexts, calls: host.calls, messages: host.messages };
  });
  expect(JSON.stringify(bridge)).not.toContain('petstown-demo:');
  expect(bridge.calls.every(call => call.name === 'refresh_office')).toBe(true);
  expect(bridge.messages).toEqual([]);
  await frame.getByTestId('embedded-office').screenshot({ path: '/tmp/petstown-demo-office.png' });

  await frame.getByRole('button', { name: 'Demo on', exact: true }).click();
  await expect(demos).toHaveCount(0);
  await expect(frame.getByTestId('demo-details')).toHaveCount(0);
  await expect(frame.getByTestId('demo-badge')).toHaveCount(0);
  await expect(frame.getByTestId('scene-agent-maple')).toBeVisible();
  await expect(frame.getByTestId('scene-agent-willow')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Demo off', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('Celebrate runs a local arrival, work, confetti and exit sequence while real pets remain', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const frame = await mount(page);
  await page.clock.install();
  const scene = frame.getByTestId('office-scene');
  await frame.getByRole('button', { name: 'Celebrate', exact: true }).click();
  await expect(scene).toHaveAttribute('data-celebration', 'entering');
  await expect(frame.locator('.venue-pet-label[data-demo="true"]')).toHaveCount(8);
  await expect(frame.getByRole('button', { name: 'Demo off', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.clock.fastForward(5100);
  await expect(scene).toHaveAttribute('data-celebration', 'working');
  await page.clock.fastForward(5000);
  await expect(scene).toHaveAttribute('data-celebration', 'cheering');
  await expect(frame.getByTestId('celebration-confetti')).toBeVisible();
  await expect(frame.locator('.venue-confetti i').first()).toBeVisible();
  await frame.getByTestId('embedded-office').screenshot({ path: '/tmp/petstown-celebration.png' });
  await page.clock.fastForward(3000);
  await expect(scene).toHaveAttribute('data-celebration', 'leaving');
  await expect(frame.getByTestId('celebration-confetti')).toHaveCount(0);
  await page.clock.fastForward(7000);
  await expect(scene).toHaveAttribute('data-celebration', 'idle');
  await expect(frame.locator('.venue-pet-label[data-demo="true"]')).toHaveCount(0);
  await expect(frame.getByTestId('scene-agent-maple')).toBeVisible();
  await expect(frame.getByTestId('scene-agent-willow')).toBeVisible();
});

test('conversation celebration IDs trigger once and refresh results cannot restart them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const frame = await mount(page);
  await page.clock.install();
  const scene = frame.getByTestId('office-scene');
  const notifyCelebration = async (id: string) => page.evaluate(id => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.celebrationId = id;
    host.notify('ui/notifications/tool-result', host.hostResult);
  }, id);
  await notifyCelebration('celebrate-command-1');
  await expect(scene).toHaveAttribute('data-celebration', 'entering');
  await page.clock.fastForward(5100);
  await expect(scene).toHaveAttribute('data-celebration', 'working');
  await notifyCelebration('celebrate-command-1');
  await expect(scene).toHaveAttribute('data-celebration', 'working');
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    host.hostResult._meta.office.celebrationId = 'celebrate-command-2';
  });
  await frame.getByRole('button', { name: 'Refresh office' }).click();
  await expect(scene).toHaveAttribute('data-celebration', 'working');
  await notifyCelebration('celebrate-command-2');
  await expect(scene).toHaveAttribute('data-celebration', 'entering');
  await page.clock.fastForward(10100);
  await expect(scene).toHaveAttribute('data-celebration', 'cheering');
  await expect(frame.getByTestId('celebration-confetti')).toBeVisible();
  await expect(frame.locator('.venue-confetti i').first()).not.toBeVisible();
  await frame.getByRole('button', { name: 'Stop celebration', exact: true }).click();
  await expect(scene).toHaveAttribute('data-celebration', 'idle');
  await expect(frame.locator('.venue-pet-label[data-demo="true"]')).toHaveCount(0);
  await expect(frame.getByTestId('embedded-agent-maple')).toBeVisible();
});
