import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  try {
    const result = await new Promise((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', code => { if (code) reject(new Error(`probe worker exited ${code}`)); });
    });
    assert.equal(result.pyodide, '314.0.6');
    assert.equal(result.process, true);
    assert.equal(result.getBuiltinModule, true);
    console.log(JSON.stringify(result));
  } finally { await worker.terminate(); }
} else {
  const { loadPyodide } = await import('./node_modules/pyodide/pyodide.mjs');
  const runtime = await loadPyodide({ indexURL: fileURLToPath(new URL('./node_modules/pyodide/', import.meta.url)) });
  const observed = JSON.parse(runtime.runPython(`import js, json\njson.dumps({"process": hasattr(js, "process"), "getBuiltinModule": hasattr(js.process, "getBuiltinModule"), "fetch": hasattr(js, "fetch"), "Function": hasattr(js, "Function")})`));
  // Presence inspection only: never request a native module, file or process.
  parentPort.postMessage({ pyodide: runtime.version, node: process.version, ...observed });
}
