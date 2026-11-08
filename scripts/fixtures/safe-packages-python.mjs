import assert from 'node:assert/strict';
import { Shell, FsError, pythonExecutorCommands as rootPython } from '@poe-platform/safe-bash';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';
import { FsError as ContractError } from '@poe-platform/safe-bash/contracts';
import { pythonExecutorCommands, PythonFailure } from '@poe-platform/safe-bash/commands/python/executor';
import { PythonFailure as EntryFailure } from '@poe-platform/safe-bash/commands/python';
import { createNodePythonWorker } from '@poe-platform/safe-bash/commands/python/node';
import { createPythonWorkerRequest } from '@poe-platform/safe-bash/commands/python/worker';
import { getCommandArguments } from '@poe-platform/safe-bash/contracts/command';

assert.equal(rootPython, pythonExecutorCommands);
assert.equal(PythonFailure, EntryFailure);
assert.equal(FsError, ContractError);
assert.equal(typeof createNodePythonWorker, 'function');
assert.equal(typeof createPythonWorkerRequest, 'function');
// Load the actual packed worker asset without downloading a Python runtime.
const worker = createNodePythonWorker({ trustedPython: true,
  runtimeModuleURL: 'data:text/javascript,export async function loadPyodide(){throw new Error("packed-runtime-reached")}',
  indexURL: '/fixture/',
});
let unsubscribe;
let deadline;
try {
  const received = new Promise((resolve, reject) => {
    unsubscribe = worker.subscribe(resolve, reject);
    deadline = setTimeout(() => reject(new Error('Packed Python worker did not start')), 10_000);
  });
  worker.postMessage({ type: 'start', shared: new SharedArrayBuffer(1024),
    invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/runtime', maxTransferBytes: 128 });
  const message = await received;
  assert.equal(message.type, 'error');
  assert.match(message.message, /packed-runtime-reached/);
} finally { clearTimeout(deadline); unsubscribe?.(); await worker.terminate(); }
const fs = new MemoryFileSystem();
await fs.writeFile('/input', new Uint8Array([0, 255, 42]));
await fs.writeFile('/run.sh', new TextEncoder().encode('python3 -c pass "two words" | python -c copy'));
let retired = 0;
const starts = [];
let binaryArguments = false;
const options = { createCapabilities(context) {
  const args = getCommandArguments(context);
  if (context.argumentValues !== undefined) assert.equal(args, context.argumentValues);
  if (context.args.length === 4) {
    assert.deepEqual(args.bytes(2), new Uint8Array([255]));
    assert.deepEqual(args.bytes(3), new Uint8Array([254]));
    binaryArguments = true;
  }
  return {};
}, createExecutor: () => ({
  async run(start) {
    starts.push(start.invocation.args);
    start.onReady();
    if (start.invocation.args[1] === 'copy') {
      const bytes = await start.dispatch({ op: 'stdin', args: [3] });
      await start.dispatch({ op: 'stdout', args: [Array.from(bytes)] });
    } else {
      await assert.rejects(start.dispatch({ op: 'stat', args: ['/missing'] }), error => error instanceof FsError && error.code === 'ENOENT');
      const handle = await start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] });
      const bytes = await start.dispatch({ op: 'read', args: [handle, 3, 0] });
      await start.dispatch({ op: 'close', args: [handle] });
      await start.dispatch({ op: 'stdout', args: [Array.from(bytes)] });
    }
    return 0;
  },
  terminate() { retired++; },
}) };
const shell = new Shell({ fs }).use(pythonExecutorCommands(options));
try {
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, new Uint8Array([0, 255, 42]));
  assert.ok(starts.some(args => JSON.stringify(args) === JSON.stringify(['-c', 'pass', 'two words'])));
  assert.equal(retired, 2);
  assert.equal((await shell.exec(String.raw`python -c pass $'\xff' $'\xfe'`)).exitCode, 0);
  assert.equal(binaryArguments, true);
  shell.use(pythonExecutorCommands(options));
  await assert.rejects(shell.exec('python -c pass'), /Command already registered: python/);
} finally { await shell.dispose(); }

let entered;
const started = new Promise(resolve => { entered = resolve; });
let cancelled = false;
const cancelling = new Shell({ fs }).use(pythonExecutorCommands({ createExecutor: () => ({
  async run(start) {
    start.onReady();
    entered();
    await new Promise(resolve => start.signal.addEventListener('abort', resolve, { once: true }));
    cancelled = true;
    return 130;
  },
  terminate() {},
}) }));
const execution = cancelling.exec('python -c pass').catch(() => undefined);
await started;
await cancelling.dispose();
await execution;
assert.equal(cancelled, true);
console.log('Packed Python imports, identity, VFS script, binary pipe, registration and cancellation passed');
