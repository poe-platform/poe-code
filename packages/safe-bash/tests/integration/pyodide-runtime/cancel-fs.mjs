import { createReplySerializer } from './stat-identity.mjs';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { MemoryFileSystem } from '../../../../safe-fs/src/fs/memory/index.ts';
const serialize = createReplySerializer();
const fs = new MemoryFileSystem();
await fs.mkdir('/work');
await fs.writeFile('/work/data', new TextEncoder().encode('abc'));
const shared = new SharedArrayBuffer(65536);
const control = new Int32Array(shared, 0, 2);
const bytes = new Uint8Array(shared, 8);
const controller = new AbortController();
const handles = new Map();
let enteredRead = false;
let backendCancelled = false;
let closed = 0;
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { shared, script: "open('/work/data', 'rb').read()" } });
const finished = new Promise((resolve, reject) => {
  worker.on('error', resolve);
  worker.on('message', message => { if (message.op === 'done') reject(new Error('blocked read incorrectly completed')); });
});
worker.on('message', async ({ op, args }) => {
  let result; let status = 1;
  try {
    if (op === 'open') { const h = await fs.open(...args); handles.set(1, h); result = 1; }
    else if (op === 'sync') result = await handles.get(args[0]).sync(args[1]);
    else if (op === 'fstat') result = await handles.get(args[0]).stat();
    else if (op === 'close') { await handles.get(args[0]).close(); handles.delete(args[0]); closed++; }
    else if (op === 'read') {
      enteredRead = true;
      await new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => { backendCancelled = true; reject(controller.signal.reason); }, { once: true });
        setTimeout(() => controller.abort(new Error('cancel blocked canonical read')), 5);
      });
    } else result = await fs[op](...args);
  } catch (error) { result = { code: 'EIO', message: error.message }; status = 2; }
  const payload = new TextEncoder().encode(serialize(result));
  bytes.set(payload); Atomics.store(control, 1, payload.length); Atomics.store(control, 0, status); Atomics.notify(control, 0);
});
try {
  const deadline = setTimeout(() => { controller.abort(); worker.terminate(); }, 10000);
  deadline.unref();
  await finished;
  assert(enteredRead); assert(backendCancelled);
} finally {
  await worker.terminate();
  for (const handle of handles.values()) { await handle.close(); closed++; }
  handles.clear();
}
assert.equal(closed, 1);
console.log(JSON.stringify({ blockedReadCancelled: true, retainedHandlesClosed: closed, parentEventLoopLive: true }));
