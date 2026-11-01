import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { snapshot, agent } from '../../src/client/test-helpers';
import { builtInPets } from '../../src/shared/pets';
import type { OfficeView } from '../../src/chatgpt/types';

// This is a protocol simulator, not evidence of an installed ChatGPT integration.
function fixture(): OfficeView {
  const data = snapshot();
  delete data.controlToken;
  data.petAssets = structuredClone(builtInPets);
  data.source = 'codex';
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
    const pet = builtInPets.find(item => item.imageUrl === route.request().url());
    if (!pet) return route.abort();
    try { await route.fulfill({ contentType: 'image/webp', body: await readFile(`.cache/pets/${pet.assetId}.webp`) }); }
    catch { await route.abort(); }
  });
  await page.goto('https://petstown-host.test/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByTestId('scene-agent-maple')).toBeVisible();
  return frame;
}

test('full office selection stays local and opens the existing chat', async ({ page }) => {
  const errors: string[] = [], urls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => urls.push(request.url()));
  const frame = await mount(page);
  await expect(frame.getByTestId('office-app')).toBeVisible();
  await frame.getByTestId('scene-agent-maple').click();
  await expect(frame.getByTestId('agent-inspector')).toContainText('Inspect the landing page');
  await expect(frame.getByTestId('open-chat')).toHaveAttribute('href', 'codex://threads/maple');
  await expect(frame.getByTestId('scene-agent-maple')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.getByRole('button', { name: 'Ask about this pet' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { contexts: unknown[]; messages: unknown[] }).contexts.length + (window as unknown as { messages: unknown[] }).messages.length)).toBe(0);
  expect(urls.some(url => /127\.0\.0\.1|localhost/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('automatic refresh preserves local selection and clears a disappeared agent', async ({ page }) => {
  const frame = await mount(page);
  await frame.getByTestId('scene-agent-willow').click();
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    host.hostResult._meta.office.snapshot.lastSeq++;
    host.hostResult._meta.office.snapshot.agents[1].task = 'Updated observation';
  });
  await expect(frame.getByTestId('agent-inspector')).toContainText('Updated observation');
  await expect(frame.getByTestId('scene-agent-willow')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } } };
    host.hostResult._meta.office.snapshot.lastSeq++;
    host.hostResult._meta.office.snapshot.agents = host.hostResult._meta.office.snapshot.agents.filter(agent => agent.agentId !== 'willow');
  });
  await expect(frame.getByTestId('agent-inspector')).toHaveCount(0);
});

test('late refresh from a prior scope cannot replace the current office', async ({ page }) => {
  const frame = await mount(page);
  await page.evaluate(() => { (window as unknown as { deferRefresh: boolean }).deferRefresh = true; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { pending: unknown[] }).pending.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const host = window as unknown as { hostResult: { _meta: { office: OfficeView } }; notify(method: string, params: unknown): void };
    host.hostResult._meta.office.scopeId = 'new-scope';
    host.hostResult._meta.office.snapshot.bridgeEpoch = 'new-epoch';
    host.hostResult._meta.office.snapshot.agents = [host.hostResult._meta.office.snapshot.agents[1]];
    host.notify('ui/notifications/tool-result', host.hostResult);
    (window as unknown as { pending: (() => void)[] }).pending.shift()?.();
  });
  await expect(frame.getByTestId('scene-agent-maple')).toHaveCount(0);
  await expect(frame.getByTestId('scene-agent-willow')).toBeVisible();
});

test('narrow dark office supports keyboard selection and escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const frame = await mount(page, ['inline']);
  await page.evaluate(() => (window as unknown as { notify(method: string, params: unknown): void }).notify('ui/notifications/host-context-changed', { theme: 'dark' }));
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await frame.getByTestId('scene-agent-maple').focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByTestId('agent-inspector')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.getByTestId('agent-inspector')).toHaveCount(0);
  expect(await frame.locator('body').evaluate(body => body.scrollWidth > body.clientWidth)).toBe(false);
});
