// Explicit real-browser integration fixture; never imported by unit tests.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const output = new URL(`./captures/${process.argv[2] ?? Date.now()}/`, here);
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./page.mjs', here))], bundle: true, platform: 'browser', format: 'esm', write: false });
const oldWorker = await readFile(new URL('../worker.mjs', here), 'utf8');
for (const needle of ['const FS = pyodide.FS;', '\npyodide.runPython(workerData.script']) {
  if (oldWorker.split(needle).length !== 2) throw new Error(`Experimental bridge source drift: ${needle}`);
}
const bridge = oldWorker.slice(oldWorker.indexOf('const FS = pyodide.FS;'), oldWorker.indexOf('\npyodide.runPython(workerData.script'));
const worker = (await readFile(new URL('./worker.mjs', here), 'utf8')).replace('/* BRIDGE_SOURCE */', bridge);
const documentSource = await readFile(new URL('./documents.py', here));
const fontSource = await readFile(new URL('../../../../../terminal-png/assets/jetbrains-mono-400-normal.ttf', here));
const hashes = {};
for (const name of ['server.mjs', 'worker.mjs', 'page.mjs', 'documents.py', '../worker.mjs', '../stat-identity.mjs', '../node_modules/pyodide/pyodide-lock.json', '../../../../../terminal-png/assets/jetbrains-mono-400-normal.ttf']) {
  hashes[name] = createHash('sha256').update(await readFile(new URL(name, here))).digest('hex');
}
hashes.servedPageBundle = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
hashes.servedWorker = createHash('sha256').update(worker).digest('hex');
await writeFile(new URL('source-hashes.json', output), JSON.stringify(hashes, null, 2), { flag: 'wx' });
const server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/capture' && request.method === 'POST') {
      const parts = []; for await (const chunk of request) parts.push(chunk);
      const result = JSON.parse(Buffer.concat(parts).toString());
      await writeFile(new URL(`${result.profile}.json`, output), JSON.stringify(result, null, 2), { flag: 'wx' });
      for (const artifact of result.artifacts ?? []) {
        const components = artifact.name.split('/');
        if (components.some(component => !component || component === '.' || component === '..')) throw new Error('Invalid artifact path');
        const destination = new URL(`${result.profile}-artifacts/${components.map(encodeURIComponent).join('/')}`, output);
        await mkdir(new URL('./', destination), { recursive: true });
        await writeFile(destination, Buffer.from(artifact.bytes), { flag: 'wx' });
      }
      response.end('saved'); return;
    }
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Pyodide document qualification</title><h1>Pyodide document qualification</h1><pre id="status">Starting real browser workers…</pre><script type="module" src="/page.mjs"></script>'); return; }
    if (pathname === '/page.mjs' || pathname === '/worker.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(pathname === '/page.mjs' ? bundle.outputFiles[0].text : worker); return; }
    if (pathname === '/documents.py') { response.end(documentSource); return; }
    if (pathname === '/font.ttf') { response.end(fontSource); return; }
    response.statusCode = 404; response.end('missing');
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
server.listen(8766, '127.0.0.1', () => console.log(`http://127.0.0.1:8766 capture=${fileURLToPath(output)}`));
