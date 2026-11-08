import { createReplySerializer } from './stat-identity.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { MemoryFileSystem } from '../../../../safe-fs/src/fs/memory/index.ts';

const delay = Number(process.argv[2] ?? 1);
const rootMount = process.argv.includes('--root-mount');
const serialize = createReplySerializer();
const fs = new MemoryFileSystem();
await fs.mkdir('/work');
if (rootMount) await fs.mkdir('/.pyodide-runtime');
await fs.writeFile('/work/ordinary.py', await readFile(new URL('./ordinary.py', import.meta.url))); 
await fs.writeFile('/work/localmod.py', new TextEncoder().encode('VALUE = 42\n'));
const shared = new SharedArrayBuffer(1024 * 1024);
const control = new Int32Array(shared, 0, 2);
const bytes = new Uint8Array(shared, 8);
const handles = new Map();
let nextHandle = 0;
const calls = [];
const pending = new Set();
let deadline;
let fail;
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { shared, rootMount } });
worker.on('message', ({ op, args }) => {
  if (op === 'done') return;
  const service = (async () => {
  calls.push(op);
  let status = 1;
  let result;
  try {
    // Deliberate asynchronous backend work on the parent, never the blocked worker.
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    if (op === 'open') {
      const handle = await fs.open(...args);
      result = ++nextHandle;
      handles.set(result, handle);
    } else if (op === 'read') {
      const buffer = new Uint8Array(args[1]);
      const count = await handles.get(args[0]).read(buffer, args[2]);
      result = [...buffer.subarray(0, count)];
    } else if (op === 'write') {
      result = await handles.get(args[0]).write(new Uint8Array(args[1]), args[2]);
    } else if (op === 'sync') result = await handles.get(args[0]).sync(args[1]);
    else if (op === 'fstat') {
      result = await handles.get(args[0]).stat();
    } else if (op === 'close') {
      result = await handles.get(args[0]).close(); handles.delete(args[0]);
    } else if (op === 'ftruncate') {
      result = await handles.get(args[0]).truncate(args[1]);
    } else {
      if (op === 'writeFile') args[1] = new Uint8Array(args[1]);
      result = await fs[op](...args);
    }
  } catch (error) { status = 2; result = { code: error.code, message: error.message }; }
  const data = new TextEncoder().encode(serialize(result));
  if (data.length > bytes.length) throw new Error('RPC reply exceeded shared buffer');
  bytes.set(data); Atomics.store(control, 1, data.length); Atomics.store(control, 0, status); Atomics.notify(control, 0);
  })();
  pending.add(service);
  service.catch(error => { fail?.(error); return worker.terminate(); }).finally(() => pending.delete(service));
});
try {
  const result = await new Promise((resolve, reject) => {
    fail = reject;
    worker.on('message', message => { if (message.op === 'done') resolve(message); });
    worker.on('error', reject);
    deadline = setTimeout(() => reject(new Error('runtime experiment exceeded 30 seconds')), 30000);
    deadline.unref();
    worker.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  });
  assert.equal(result.version, '314.0.6');
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/data.bin')), 'abXYef');
  assert.equal(handles.size, 0);
  console.log(JSON.stringify({ version: result.version, python: result.python, node: process.version, backendDelayMs: delay, operations: calls.length, operationNames: [...new Set(calls)], assertions: result.assertions }));
} finally { clearTimeout(deadline); await worker.terminate(); await Promise.allSettled([...pending]); await Promise.all([...handles.values()].map(handle => handle.close())); }
