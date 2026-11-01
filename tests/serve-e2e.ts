// Private test process. This event-injection endpoint is never imported by the product server.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createOfficeServer } from '../src/server/server.js';
import type { OfficeAdapter } from '../src/server/adapter.js';
import { emptySnapshot, type OfficeAgent, type OfficeEvent } from '../src/shared/contract.js';
import { builtInPets } from '../src/shared/pets.js';

const at = new Date().toISOString();
const agents: OfficeAgent[] = [
  {
    agentId: 'maple', parentAgentId: null, projectId: 'pets', displayName: 'Maple', role: 'Inspector',
    task: 'Inspect the current workspace', runtimeState: 'working', activityKind: 'reading',
    lastObservedAt: at, pendingRequestIds: [], petAssetId: 'dewey',
    recentActivity: [{ activityId: 'read-1', agentId: 'maple', kind: 'reading', summary: 'Reading the project design', occurredAt: at, sourceItemId: 'item-1', source: 'fixture' }],
  },
  {
    agentId: 'willow', parentAgentId: 'maple', projectId: 'pets', displayName: 'Willow', role: null,
    task: null, runtimeState: 'waiting-for-input', activityKind: 'unknown', lastObservedAt: at,
    pendingRequestIds: ['missing-details'], petAssetId: 'hoots', recentActivity: [],
  },
];
const snapshot = emptySnapshot('fixture-e2e');
Object.assign(snapshot, {
  source: 'fixture',
  agents,
  projects: [{ projectId: 'pets', displayName: 'PetsTown test project', cwd: null }],
  petAssets: builtInPets,
  connection: { status: 'connected', lastObservedAt: at, message: 'Explicit browser test fixture' },
});
snapshot.capabilities.observeAgents = { supported: true, reason: null };
snapshot.capabilities.observeHandoffs = { supported: true, reason: 'Explicit synthetic handoff fixture' };
const listeners = new Set<(event: OfficeEvent) => void>();
const adapter: OfficeAdapter = {
  initialSnapshot: () => structuredClone(snapshot),
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  stop() { listeners.clear(); },
};

const petAssetFiles = Object.fromEntries(builtInPets
  .map(pet => [pet.assetId, resolve('.cache/pets', `${pet.assetId}.webp`)])
  .filter(([, path]) => existsSync(path)));
const office = await createOfficeServer({ adapter, port: 5417, distDir: resolve('dist'), presentationStepMs: 20_000, petAssetFiles });
let sourceSeq = 0;
const control = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/events') { response.writeHead(404).end(); return; }
  try {
    let text = '';
    for await (const chunk of request) text += chunk;
    const input = JSON.parse(text);
    const event = {
      protocolVersion: 1, bridgeEpoch: 'test-adapter', seq: ++sourceSeq, eventId: randomUUID(),
      occurredAt: new Date().toISOString(), source: 'fixture', ...input,
    } as OfficeEvent;
    for (const listener of listeners) listener(event);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  } catch { response.writeHead(400).end(); }
});
await new Promise<void>((done) => control.listen(5418, '127.0.0.1', done));
console.log(`E2E office ${office.url}; fixture event controls on loopback port 5418`);
async function close() { control.close(); await office.close(); process.exit(0); }
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
