import assert from 'node:assert/strict';
import { loadPyodide } from './node_modules/pyodide/pyodide.mjs';
const pyodide = await loadPyodide({ indexURL: new URL('./node_modules/pyodide/', import.meta.url).pathname });
pyodide.FS.writeFile('/probe', 'actual');
const node = pyodide.FS.lookupPath('/probe').node;
const original = node.stream_ops;
const pending = [];
let called = 0;
node.stream_ops = { ...original, read(stream, buffer, offset) {
  called++;
  buffer.set(new TextEncoder().encode('actual'), offset);
  const operation = new Promise(resolve => setTimeout(() => resolve(6), 1));
  pending.push(operation);
  return operation;
} };
const result = pyodide.runPython("open('/probe', 'rb').read(6)").toJs();
await Promise.all(pending);
const asyncResult = (await pyodide.runPythonAsync("open('/probe', 'rb').read(6)")).toJs();
await Promise.all(pending);
assert.equal(called, 2);
assert.notDeepEqual([...result], [...new TextEncoder().encode('actual')]);
assert.notDeepEqual([...asyncResult], [...new TextEncoder().encode('actual')]);
const canRunSync = await pyodide.runPythonAsync('from pyodide.ffi import can_run_sync\ncan_run_sync()');
// Exercise the supported suspension API across the actual FS callback boundary,
// rather than treating engine feature detection as filesystem qualification.
let suspension = { status: canRunSync ? 'not-requested' : 'unavailable', canRunSync };
// This invalid re-entry can leave the runtime unusable. Opt in only in a fresh
// process; its nonzero exit is blocker evidence, never an acceptance pass.
if (canRunSync && process.argv.includes('--suspension')) {
  pyodide.globals.set('_probe_async', () => new Promise(resolve => setTimeout(() => resolve(6), 1)));
  const control = await pyodide.runPythonAsync('from pyodide.ffi import run_sync\nrun_sync(_probe_async())');
  assert.equal(control, 6);
  pyodide.globals.delete('_probe_async');
  console.log(JSON.stringify({ node: process.version, version: pyodide.version, suspensionControl: 'passed' }));
  const runSync = pyodide.runPython('from pyodide.ffi import run_sync\nrun_sync');
  let callbackError;
  node.stream_ops = { ...original, read(stream, buffer, offset) {
    const operation = new Promise(resolve => setTimeout(() => {
      buffer.set(new TextEncoder().encode('actual'), offset);
      resolve(6);
    }, 1));
    pending.push(operation);
    try { return runSync(operation); }
    catch (error) {
      callbackError = String(error);
      console.log(JSON.stringify({ node: process.version, version: pyodide.version,
        suspension: { status: 'blocked', callbackError } }));
      throw error;
    }
  } };
  try {
    const bytes = (await pyodide.runPythonAsync("open('/probe', 'rb').read(6)")).toJs();
    assert.deepEqual([...bytes], [...new TextEncoder().encode('actual')]);
    suspension = { status: 'passed', bytes: [...bytes] };
  } catch (error) {
    suspension = { status: 'blocked', error: String(error), callbackError };
  } finally {
    await Promise.all(pending);
    try { runSync.destroy(); }
    catch (error) { suspension = { ...suspension, cleanupError: String(error) }; }
    node.stream_ops = original;
  }
}
console.log(JSON.stringify({ node: process.version, canRunSync, version: pyodide.version, promiseWasAwaited: false, pythonReadBytes: [...result], pythonAsyncEntryReadBytes: [...asyncResult], callbackCalls: called, JSPI: typeof WebAssembly.Suspending, suspension }));
