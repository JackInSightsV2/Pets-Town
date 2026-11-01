// Mac live baseline. Setup: npm ci && npm run pets:fetch && npm run build
// Then: npx playwright install chromium && npx tsx tests/manual/observer-baseline-probe.ts
// Scope via PETSTOWN_METADATA_CWDS; optional PETSTOWN_METADATA_SOCKET selects an EXISTING daemon.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createAdapter } from '../../src/codex/metadata-adapter.js';
import { createOfficeServer } from '../../src/server/server.js';
import { approvedLocalPetFiles } from '../../src/server/main.js';
import { nativeAssetFor } from '../../src/ui/view-model.js';
import type { RuntimeState } from '../../src/shared/contract.js';

const started = Date.now();
const requested = Number(process.env.PETSTOWN_PROBE_MS ?? 60000);
const waitMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 120000) : 60000;
const gates: Record<string, boolean> = {};
const states: RuntimeState[] = [];
let cliVersion: string | null = null, revision: string | null = null;
let pet: { assetId: string; width: number; height: number; sha256: string; frameOffsets: string[] } | null = null;
let observer: Awaited<ReturnType<typeof createAdapter>> | undefined;
let bridge: Awaited<ReturnType<typeof createOfficeServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let unsubscribe: (() => void) | undefined;
let gate = 'mac', armed = false, upserts = 0;
const requireGate = (name: string, value: boolean) => {
  gate = name; gates[name] = value;
  if (!value) throw new Error('Gate failed.');
};
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
// Hard stop terminates only this diagnostic, its bridge and its browser pipe; never the daemon.
const deadline = setTimeout(() => {
  console.error('Probe deadline reached; live gate unpassed.');
  console.log(JSON.stringify({ gates, unpassedGate: gate, elapsedMs: Date.now() - started }));
  process.exit(2);
}, waitMs + 45000);

async function run() {
  requireGate('mac', process.platform === 'darwin');
  gate = 'cliVersion';
  const version = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  cliVersion = version.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? null;
  requireGate('cliVersion', cliVersion !== null);
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[a-f0-9]{40}$/.test(output)) revision = output;
  } catch { /* Version-independent execution is still useful. */ }
  gate = 'connected';
  observer = await createAdapter();
  const initial = await observer.initialSnapshot();
  requireGate('connected', initial.source === 'codex' && initial.connection.status === 'connected');
  const candidates = initial.agents.filter(agent => agent.runtimeState === 'working' && nativeAssetFor(agent, initial.petAssets));
  const agent = candidates.find(candidate => candidate.parentAgentId === null) ?? candidates[0];
  requireGate('existingWorkingAgent', !!agent);
  if (!agent) return;
  const asset = nativeAssetFor(agent, initial.petAssets)!;
  requireGate('approvedPet', ['codex', 'dewey', 'hoots'].includes(asset.assetId));
  states.push(agent.runtimeState);
  let changed: RuntimeState | undefined;
  unsubscribe = observer.subscribe(event => {
    if (!armed || event.type !== 'agent.upserted' || event.agentId !== agent.agentId) return;
    upserts++;
    const state = event.data.agent.runtimeState;
    if (state !== 'unknown' && state !== 'closed' && state !== agent.runtimeState && !changed) {
      changed = state; states.push(state);
    }
  });
  gate = 'browserLaunch';
  bridge = await createOfficeServer({ adapter: observer, port: 0, distDir: resolve('dist'),
    officeAssetPath: resolve('assets/office/office-v1.png'), petAssetFiles: await approvedLocalPetFiles(),
    presentationStepMs: 60000 });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  let pageErrors = 0;
  page.on('pageerror', () => { pageErrors++; });
  await page.goto(bridge.url, { timeout: 10000 });
  gate = 'browserInitialState';
  const row = page.getByTestId('agent-button-' + agent.agentId);
  await row.locator('.status-pill.state-working').waitFor({ timeout: 10000 });
  await row.click();
  requireGate('browserInitialState', await row.getAttribute('aria-pressed') === 'true');
  armed = true;
  gate = 'nativeSprite';
  const sprite = page.getByTestId('scene-agent-' + agent.agentId).locator('.native-pet');
  await sprite.locator('img').waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForFunction(id => document.querySelector('[data-testid="scene-agent-' + CSS.escape(id) + '"] .native-pet')?.getAttribute('data-pet-load') === 'loaded', agent.agentId, { timeout: 12000 });
  const dims = await sprite.locator('img').evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }));
  requireGate('spriteDimensions', dims.width === asset.width && dims.height === asset.height);
  const lefts = new Set<string>();
  for (let i = 0; i < 30 && lefts.size < 3; i++) {
    lefts.add(await sprite.locator('img').evaluate(image => getComputedStyle(image).left));
    await delay(100);
  }
  requireGate('spriteSequence', lefts.size >= 2);
  gate = 'assetHash';
  const src = await sprite.locator('img').getAttribute('src');
  if (!src) throw new Error('No sprite source.');
  const response = await fetch(new URL(src, bridge.url), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not inspect approved sprite.');
  pet = { assetId: asset.assetId, width: dims.width, height: dims.height,
    sha256: createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), frameOffsets: [...lefts] };
  gate = 'presentation';
  await page.getByTestId('start-day').click();
  await page.getByTestId('skip-standup').waitFor({ timeout: 5000 });
  await page.getByTestId('skip-standup').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="office-scene"]')?.getAttribute('data-presentation') === 'live', undefined, { timeout: 5000 });
  await page.getByTestId('reset-scene').click();
  await page.getByTestId('start-day').waitFor({ timeout: 5000 });
  requireGate('presentation', true);
  gate = 'naturalTransition';
  const until = Date.now() + waitMs;
  while (!changed && Date.now() < until) await delay(100);
  requireGate('naturalTransition', !!changed);
  gate = 'browserTransition';
  await row.locator('.status-pill.state-' + changed).waitFor({ timeout: 5000 });
  requireGate('browserTransition', true);
  requireGate('browserErrors', pageErrors === 0);
  unsubscribe(); unsubscribe = undefined;
  await browser.close(); browser = undefined;
  await bridge.close(); bridge = undefined; observer = undefined;
  gate = 'sameAgentAfterClose';
  const fresh = await createAdapter();
  try {
    const again = await fresh.initialSnapshot();
    requireGate('sameAgentAfterClose', again.connection.status === 'connected'
      && again.agents.some(candidate => candidate.agentId === agent.agentId && candidate.runtimeState !== 'unknown'));
  } finally { await fresh.stop(); }
}
try { await run(); }
catch { process.exitCode = 1; console.error('Probe gate did not pass; no runtime details were exported.'); }
finally {
  clearTimeout(deadline);
  unsubscribe?.();
  try { await browser?.close(); } catch { process.exitCode = 1; }
  try { if (bridge) await bridge.close(); else await observer?.stop(); } catch { process.exitCode = 1; }
  console.log(JSON.stringify({ cliVersion, revision, gates, unpassedGate: process.exitCode ? gate : null,
    upserts, states, pet, elapsedMs: Date.now() - started,
    nonMutation: 'Production read-only observer and presentation controls only. Same identity is checked after observer close/reconnect; no work is started, resumed, assigned or interrupted.',
    requestDetails: 'unavailable', handoffs: 'unavailable; use the separate handoff history probe' }));
}
