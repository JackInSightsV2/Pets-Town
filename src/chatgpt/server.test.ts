import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createChatgptServer } from './server.js';
import { officeView, readScope } from './snapshot.js';
import { snapshot, agent, request } from '../client/test-helpers.js';
import { isOfficeSnapshot } from '../client/validation.js';
import { OFFICE_RESOURCE_URI } from './types.js';

test('scope is explicit, absolute and normalized', () => {
  assert.throws(() => readScope(undefined), /explicit/);
  for (const input of ['[]', '["relative"]', '{}', '[null]']) assert.throws(() => readScope(input));
  assert.deepEqual(readScope('["/project/","/project"]'), ['/project']);
});

test('projection excludes other projects, control tokens, paths and unknown fields', () => {
  const input = snapshot();
  input.projects.push({ projectId: 'other', displayName: 'Private project', cwd: '/private' });
  input.agents.push({ ...agent('secret-agent'), projectId: 'other' });
  input.agents[0].parentAgentId = 'secret-agent';
  input.agents[0].pendingRequestIds = ['request-1'];
  input.pendingRequests = [request(), request('secret-request', 'secret-agent')];
  input.recentHandoffs = [{ handoffId: 'secret-handoff', fromAgentId: 'main', toAgentId: 'secret-agent', summary: 'private', occurredAt: '2026-11-01T13:00:00Z', sourceItemId: 'secret' }];
  Object.assign(input.agents[0], { secretExtension: 'NEVER_SHARE' });
  const view = officeView(input, ['/project']);
  assert.equal(isOfficeSnapshot(view.snapshot), true);
  assert.equal(view.snapshot.agents.length, 1);
  assert.equal(view.snapshot.agents[0].parentAgentId, null);
  assert.equal(view.snapshot.projects[0].cwd, null);
  assert.equal(view.snapshot.pendingRequests.length, 1);
  assert.equal(view.snapshot.pendingRequests[0].responseCapability.supported, false);
  assert.deepEqual(view.snapshot.recentHandoffs, []);
  const encoded = JSON.stringify(view);
  for (const value of ['test-control-token', 'controlToken', '/project', '/private', 'secret-agent', 'secret-request', 'NEVER_SHARE']) assert.equal(encoded.includes(value), false, value);
  assert.throws(() => officeView(input, ['/project'], { agentId: 'secret-agent' }), /unavailable/);
  assert.throws(() => officeView(input, ['/project'], { projectId: 'other' }), /unavailable/);
  assert.equal(input.controlToken, 'test-control-token');
  input.agents[0].pendingRequestIds.push('details-unavailable');
  assert.ok(officeView(input, ['/project']).snapshot.agents[0].pendingRequestIds.includes('details-unavailable'));
});

test('MCP initialize, resource, tools, live refresh, restart rejection and read-only contract', async () => {
  let current = snapshot();
  current.agents[0].petAssetId = 'codex';
  let opened = 0, closed = 0;
  const app = createChatgptServer({ allowedCwds: ['/project'], readHtml: async () => '<html>office</html>',
    source: async () => { opened++; return { getSnapshot: () => structuredClone(current), close: async () => { closed++; } }; } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-host', version: '1' });
  try {
    await app.server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name), ['show_office', 'celebrate', 'refresh_office', 'inspect_agent']);
    assert.ok(tools.tools.every(t => t.annotations?.readOnlyHint === true));
    assert.equal(opened, 0, 'initialization must not wait for the observer');
    const html = await client.readResource({ uri: OFFICE_RESOURCE_URI });
    assert.equal(html.contents[0].mimeType, 'text/html;profile=mcp-app');
    const result = await client.callTool({ name: 'show_office', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(opened, 1);
    const data = result.structuredContent as { scopeId: string; agents: Array<{ runtimeState: string }> };
    assert.equal(data.agents[0].runtimeState, 'working');
    assert.equal(JSON.stringify(result).includes('controlToken'), false);
    current.agents[0].runtimeState = 'waiting-for-input'; current.lastSeq++;
    const refreshed = await client.callTool({ name: 'refresh_office', arguments: { scopeId: data.scopeId } });
    assert.equal((refreshed.structuredContent as typeof data).agents[0].runtimeState, 'waiting-for-input');
    assert.equal(opened, 1, 'same source across calls');
    const inspected = await client.callTool({ name: 'inspect_agent', arguments: { agentId: 'main' } });
    assert.equal((inspected.structuredContent as typeof data).agents.length, 1);
    assert.equal(inspected._meta, undefined, 'inspection must not remount UI');
    const wrongAgent = await client.callTool({ name: 'inspect_agent', arguments: { agentId: 'unknown' } });
    assert.equal(wrongAgent.isError, true);
    current = snapshot(0, 'new-epoch');
    const restarted = await client.callTool({ name: 'refresh_office', arguments: { scopeId: data.scopeId } });
    assert.equal(restarted.isError, undefined, 'same project scope survives a different MCP process epoch');
    assert.equal((restarted.structuredContent as typeof data).scopeId, data.scopeId);
    const stale = await client.callTool({ name: 'refresh_office', arguments: { scopeId: 'different-project-scope' } });
    assert.equal(stale.isError, true);
    assert.equal(stale._meta, undefined, 'no new-scope data on stale refresh');
  } finally { await app.close(); await client.close(); }
  assert.equal(closed, 1);
});

test('scope identity is stable across processes but changes with allowed projects', () => {
  assert.equal(officeView(snapshot(0, 'a'), ['/project']).scopeId, officeView(snapshot(0, 'b'), ['/project']).scopeId);
  assert.notEqual(officeView(snapshot(), ['/project']).scopeId, officeView(snapshot(), ['/other']).scopeId);
});

test('project filters use separate cursor scopes', () => {
  const input = snapshot();
  input.projects.push({ projectId: 'second', displayName: 'Second', cwd: '/project' });
  assert.notEqual(officeView(input, ['/project'], { projectId: input.projects[0].projectId }).scopeId,
    officeView(input, ['/project'], { projectId: 'second' }).scopeId);
});

test('celebrate returns a fresh view-local trigger without adding fake source agents', async () => {
  const current = snapshot();
  const before = structuredClone(current);
  const app = createChatgptServer({ allowedCwds: ['/project'], readHtml: async () => '<html>office</html>',
    source: async () => ({ getSnapshot: () => current, close: async () => {} }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'celebration-test', version: '1' });
  try {
    await app.server.connect(serverTransport); await client.connect(clientTransport);
    const first = await client.callTool({ name: 'celebrate', arguments: {} });
    const second = await client.callTool({ name: 'celebrate', arguments: {} });
    const a = first._meta?.office as { celebrationId: string; snapshot: { agents: unknown[] } };
    const b = second._meta?.office as typeof a;
    assert.match(a.celebrationId, /^[a-f0-9-]{36}$/);
    assert.notEqual(a.celebrationId, b.celebrationId);
    assert.equal(a.snapshot.agents.length, 1);
    assert.deepEqual(current, before);
    assert.equal(JSON.stringify(first.structuredContent).includes('petstown-demo:'), false);
    const refresh = await client.callTool({ name: 'show_office', arguments: {} });
    assert.equal((refresh._meta?.office as typeof a).celebrationId, undefined);
    assert.equal((await client.callTool({ name: 'celebrate', arguments: { projectId: 'private' } })).isError, true);
  } finally { await client.close(); await app.close(); }
});
