import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from './node_modules/pyodide/pyodide.mjs';

const control = new Int32Array(workerData.shared, 0, 2);
const payload = new Uint8Array(workerData.shared, 8);
function rpc(op, args) {
  Atomics.store(control, 0, 0);
  parentPort.postMessage({ op, args });
  while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0);
  const response = JSON.parse(new TextDecoder().decode(payload.subarray(0, Atomics.load(control, 1))));
  if (Atomics.load(control, 0) === 2) throw new pyodide.FS.ErrnoError(pyodide.ERRNO_CODES[response.code] ?? pyodide.ERRNO_CODES.EIO);
  return response;
}
const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL('./node_modules/pyodide/', import.meta.url)) });
pyodide.setStdin({ read(buffer) {
  const bytes = rpc('stdin', Math.min(buffer.length, 32));
  buffer.set(bytes);
  return bytes.length;
} });
for (const [name, configure] of [['stdout', 'setStdout'], ['stderr', 'setStderr']]) {
  pyodide[configure]({ write(buffer) {
    // Transfer bounded owned chunks; never expose a mutable Wasm heap view.
    for (let offset = 0; offset < buffer.length; offset += 32) {
      try { rpc(name, Array.from(buffer.subarray(offset, offset + 32))); }
      catch (error) {
        if (offset) return offset;
        throw error;
      }
    }
    return buffer.length;
  } });
}
// Flush before an exception crosses into JS: Pyodide's exception formatter can
// otherwise consume buffered stderr and attach it to PythonError's message.
const runScript = pyodide.runPython(`
def _stdio_run(script):
 import sys
 try:
  exec(compile(script, '<script>', 'exec'), globals())
 finally:
  primary = sys.exc_info()[0]
  flush_error = None
  for stream in (sys.stdout, sys.stderr):
   try:
    if stream is not None and not getattr(stream, 'closed', False):
     stream.flush()
   except BaseException as error:
    if flush_error is None:
     flush_error = error
  if primary is None and flush_error is not None:
   raise flush_error
_stdio_run
`);
parentPort.postMessage({ ready: true, version: pyodide.version });
parentPort.on('message', ({ script }) => {
  try {
    runScript(script);
    parentPort.postMessage({ done: true });
  } catch (error) {
    parentPort.postMessage({ failed: String(error) });
  }
});
