import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist-chatgpt');
await mkdir(output, { recursive: true });
const ui = await build({
  absWorkingDir: root, entryPoints: ['src/chatgpt/ui/main.tsx'], bundle: true, write: false,
  outdir: output, platform: 'browser', format: 'iife', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.png': 'dataurl' },
});
const js = ui.outputFiles.find(f => f.path.endsWith('.js'))?.text;
const css = ui.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';
if (!js) throw new Error('Missing embedded UI bundle.');
// Inline assets: the iframe never fetches code or office data from localhost.
await writeFile(resolve(output, 'office.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PetsTown</title><style>'
  + css.replaceAll('</style', '<\\/style') + '</style></head><body><div id="root"></div><script>'
  + js.replaceAll('</script', '<\\/script') + '</script></body></html>');
await build({
  absWorkingDir: root, entryPoints: ['src/chatgpt/main.ts'], bundle: true,
  outfile: resolve(output, 'server.mjs'), platform: 'node', target: 'node22', format: 'esm',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
console.log('Built dist-chatgpt/office.html and server.mjs.');
