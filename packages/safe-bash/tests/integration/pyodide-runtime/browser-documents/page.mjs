/* global document, window, Worker, crossOriginIsolated */
import { MemoryFileSystem } from '../../../../../safe-fs/src/fs/memory/index.ts';
import { createReplySerializer } from '../stat-identity.mjs';

const status = document.querySelector('#status');
const log = message => { status.textContent += `\n${message}`; };
window.results = [];
const script = await (await fetch('/documents.py')).text();
const font = new Uint8Array(await (await fetch('/font.ttf')).arrayBuffer());
for (const [profile, delay, rootMount] of [['memfs', 0, false], ['bridge', 0, false], ['bridge-delayed', 1, false], ['root-bridge', 0, true]]) {
  const fs = new MemoryFileSystem();
  for (const path of ['/work', '/tmp', '/.pyodide-runtime']) await fs.mkdir(path);
  await fs.writeFile('/work/documents.py', new TextEncoder().encode(script));
  await fs.writeFile('/work/font.ttf', font);
  const shared = new SharedArrayBuffer(1024 * 1024);
  const control = new Int32Array(shared, 0, 2), bytes = new Uint8Array(shared, 8);
  const handles = new Map(), operations = {}, serialize = createReplySerializer();
  let nextHandle = 0;
  const worker = new Worker('/worker.mjs', { type: 'module' });
  const result = await new Promise(resolve => {
    const deadline = setTimeout(() => resolve({ profile, error: 'worker deadline 15 minutes' }), 900000);
    worker.onerror = error => { clearTimeout(deadline); resolve({ profile, error: error.message }); };
    worker.onmessage = async ({ data }) => {
      if (data.op === 'progress') { log(`${profile}: ${data.message}`); return; }
      if (data.op === 'done') { clearTimeout(deadline); resolve({ ...data, profile }); return; }
      const { op, args } = data;
      operations[op] = (operations[op] ?? 0) + 1;
      let value, code = 1;
      try {
        if (delay) await new Promise(done => setTimeout(done, delay));
        if (op === 'open') { value = ++nextHandle; handles.set(value, await fs.open(...args)); }
        else if (op === 'read') { const buffer = new Uint8Array(args[1]); const count = await handles.get(args[0]).read(buffer, args[2]); value = [...buffer.subarray(0, count)]; }
        else if (op === 'write') value = await handles.get(args[0]).write(new Uint8Array(args[1]), args[2]);
        else if (op === 'fstat') value = await handles.get(args[0]).stat();
        else if (op === 'ftruncate') value = await handles.get(args[0]).truncate(args[1]);
        else if (op === 'sync') value = await handles.get(args[0]).sync(args[1]);
        else if (op === 'close') { value = await handles.get(args[0]).close(); handles.delete(args[0]); }
        else { if (op === 'writeFile') args[1] = new Uint8Array(args[1]); value = await fs[op](...args); }
      } catch (error) { code = 2; value = { code: error.code, message: error.message }; }
      const encoded = new TextEncoder().encode(serialize(value));
      if (encoded.length > bytes.length) { clearTimeout(deadline); resolve({ profile, error: 'RPC reply exceeds shared buffer' }); return; }
      bytes.set(encoded); Atomics.store(control, 1, encoded.length); Atomics.store(control, 0, code); Atomics.notify(control, 0);
    };
    worker.postMessage({ shared, rootMount, profile, script, font });
  });
  result.operations = operations; result.openHandles = handles.size;
  result.browser = navigator.userAgent; result.crossOriginIsolated = crossOriginIsolated;
  result.backendDelayMs = delay;
  result.canonicalArtifactChecks = [];
  if (profile !== 'memfs') {
    const candidates = [
      ...(result.artifacts ?? []).map(artifact => ({ ...artifact, path: `/work/${artifact.name}` })),
      ...(result.report?.workflows?.root_namespace?.artifacts ?? []).map(artifact => ({ ...artifact, name: artifact.path })),
    ];
    for (const artifact of candidates) {
      const actual = await fs.readFile(artifact.path);
      const equal = actual.length === artifact.bytes.length && actual.every((value, index) => value === artifact.bytes[index]);
      result.canonicalArtifactChecks.push({ name: artifact.name, bytes: actual.length, equal });
      if (!equal) result.error = `canonical artifact mismatch: ${artifact.name}`;
    }
  }
  window.results.push(result);
  const captured = await fetch('/capture', { method: 'POST', body: JSON.stringify(result) });
  if (!captured.ok) throw new Error(`capture persistence failed: ${await captured.text()}`);
  worker.terminate();
  await Promise.all([...handles.values()].map(handle => handle.close()));
  log(`${profile}: ${JSON.stringify({ report: result.report, error: result.error, operations, openHandles: result.openHandles })}`);
}
window.finished = true;
log('All qualification profiles finished.');
