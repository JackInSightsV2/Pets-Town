import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { createAdapter as createMacAdapter } from '../codex/lifecycle/mac-adapter.js';
import { createAdapter as createWindowsAdapter } from '../codex/lifecycle/windows-adapter.js';
import { createOfficeServer } from '../server/server.js';
import { createChatgptServer } from './server.js';
import { readScope } from './snapshot.js';

// Scope is explicit because the installed plugin runs from its cache, not the project.
const allowedCwds = readScope(process.env.PETSTOWN_METADATA_CWDS);
const app = createChatgptServer({
  allowedCwds,
  source: async () => createOfficeServer({ adapter: await (process.platform === 'win32' ? createWindowsAdapter() : createMacAdapter()), port: 0 }),
  readHtml: () => readFile(new URL('./office.html', import.meta.url), 'utf8'),
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
const transport = new StdioServerTransport();
await app.server.connect(transport);
const onTransportClose = transport.onclose;
transport.onclose = () => { onTransportClose?.(); void stop(); };
