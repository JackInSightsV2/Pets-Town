import WebSocket from 'ws';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Verify discovery through the running desktop, not a directly launched MCP client.
const socketPath = process.env.PETSTOWN_METADATA_SOCKET ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
const socket = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: 5000 });
let nextId = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
socket.on('message', bytes => {
  const message = JSON.parse(bytes.toString());
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(message.id);
  if (message.error) request.reject(new Error(`Desktop request failed (${message.error.code}).`));
  else request.resolve(message.result);
});
function call(method: string, params: object): Promise<any> {
  return new Promise((done, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Desktop ${method} timed out.`)); }, 15000);
    pending.set(id, { resolve: done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await new Promise<void>((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  await call('initialize', { clientInfo: { name: 'petstown-plugin-discovery-check', version: '1' }, capabilities: { experimentalApi: true } });
  socket.send(JSON.stringify({ method: 'initialized' }));
  const { plugin } = await call('plugin/read', { marketplacePath: resolve('.agents/plugins/marketplace.json'), pluginName: 'petstown' });
  if (!plugin.summary.installed || !plugin.summary.enabled || !plugin.mcpServers.includes('petstown')) {
    throw new Error('Desktop has not discovered the enabled PetsTown MCP server. Repackage and install the compatibility manifest.');
  }
  const { data } = await call('mcpServerStatus/list', { serverName: 'petstown', detail: 'full' });
  const server = data.find((item: { name: string }) => item.name === 'petstown');
  const expected = ['show_office', 'refresh_office', 'inspect_agent'];
  if (!server || server.toolsError || expected.some(name => !server.tools[name])
    || !server.resources.some((resource: { uri: string }) => resource.uri === 'ui://petstown/office-v1.html')) {
    throw new Error('Desktop could not discover all PetsTown tools and its office resource.');
  }
  console.log(JSON.stringify({ plugin: plugin.summary.id, version: plugin.summary.localVersion,
    discoveredByRunningDesktop: true, tools: expected, resource: 'ui://petstown/office-v1.html', toolsError: server.toolsError,
    visualAcceptance: 'Not checked by this probe.' }, null, 2));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  socket.close();
}
