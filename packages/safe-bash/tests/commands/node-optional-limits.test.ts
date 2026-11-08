import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../src/core.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { NODE_PROFILE, nodeCommands } from '../../src/commands/node/index.js';
import { FsError } from '../../src/contracts/errors.js';
import { fsDescriptor } from '../../src/commands/node/host.js';

test('Node transports branded filesystem errors without inspecting accessors or extra symbols', () => {
  const error = new FsError('ENOENT', { path: '/missing', syscall: 'readFile' });
  let reads = 0;
  const unexpectedRead = () => { reads++; throw new Error('unexpected accessor'); };
  Object.defineProperty(error, 'stack', { get: unexpectedRead });
  Object.defineProperty(error, 'cause', { get: unexpectedRead });
  assert.deepEqual(fsDescriptor(error), {
    name: 'FsError', message: error.message, code: 'ENOENT', errno: error.errno,
    path: '/missing', syscall: 'readFile', dest: null,
  });
  Object.defineProperty(error, Symbol('extra'), { value: true });
  assert.equal(fsDescriptor(error), undefined);
  const accessor = new FsError('ENOENT');
  Object.defineProperty(accessor, 'path', { get: unexpectedRead });
  assert.equal(fsDescriptor(accessor), undefined);
  const branded = { name: 'FsError', message: 'missing', code: 'ENOENT', errno: -2 };
  Object.defineProperty(branded, Symbol.for('@poe-code/safe-fs.FsError'), { get: unexpectedRead });
  assert.equal(fsDescriptor(branded), undefined);
  const foreign = { name: 'FsError', message: 'missing', code: 'ENOENT', errno: -2 };
  assert.equal(fsDescriptor(foreign), undefined);
  Object.defineProperty(foreign, Symbol.for('@poe-code/safe-fs.FsError'), { value: true });
  assert.deepEqual(fsDescriptor(foreign), { ...foreign, path: null, syscall: null, dest: null });
  const mutable = { ...foreign, [Symbol.for('@poe-code/safe-fs.FsError')]: true };
  assert.equal(fsDescriptor(mutable), undefined);
  assert.equal(fsDescriptor(new Proxy(error, { get: unexpectedRead, getPrototypeOf: unexpectedRead })), undefined);
  assert.equal(reads, 0);
});

for (const limits of [undefined, { outputBytes: 200 }]) test(`provider Node has independent optional budgets: ${JSON.stringify(limits)}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ ...limits === undefined ? {} : { limits }, grants: { stdoutWrite: true }, provider: {
    profile: NODE_PROFILE, identity: 'optional-limits', prepare(request, services) {
      assert.equal(request.limits.steps, undefined);
      assert.equal(request.limits.oldGenerationMiB, undefined);
      return { async start() {
        services.reserve('x'.repeat(1000), 1)();
        for (let sequence = 1; sequence <= 140; sequence++) {
          await services.request({ sequence, op: 'writeOutput', authority: 'stdout', path: null, flag: null, text: 'x', moduleKey: null });
          services.delivered(sequence);
        }
        return { kind: 'entryReturned', observation: { state: 'unknown', fault: false, name: null, message: null, code: null } };
      }, cancel() {}, async retire() { return { acquisition: 'exited', exitCode: 0 }; } };
    },
  } }));
  try {
    const result = await shell.exec(`node -e '${' '.repeat(262145)}'`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 140);
  } finally { await shell.dispose(); }
});

test('explicit provider output budget remains enforced', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ limits: { outputBytes: 1 }, grants: { stdoutWrite: true }, provider: {
    profile: NODE_PROFILE, identity: 'explicit-limit', prepare(_request, services) {
      return { async start() {
        await services.request({ sequence: 1, op: 'writeOutput', authority: 'stdout', path: null, flag: null, text: 'xx', moduleKey: null });
        throw new Error('expected budget failure');
      }, cancel() {}, async retire() { return { acquisition: 'exited', exitCode: 0 }; } };
    },
  } }));
  try { assert.notEqual((await shell.exec('node -e 1')).exitCode, 0); }
  finally { await shell.dispose(); }
});

test('Node transfer counters preserve safe integers above signed 32-bit range', async () => {
  const { channel, publish, acquire } = await import('../../src/commands/node/channel.js');
  const { nodeLimits } = await import('../../src/commands/node/types.js');
  const shared = channel(new SharedArrayBuffer(nodeLimits.sabBytes));
  const frame = { frame: 2 ** 32 + 1, sequence: 2 ** 32 + 2, phase: 1, total: 2 ** 32 + 3, offset: 2 ** 32, bytes: new Uint8Array([1]) };
  publish(shared, 1, frame);
  assert.deepEqual(acquire(shared, 1, frame.frame, frame.sequence), frame);
});

test('Worker transport streams large metadata and payloads beyond former total budgets', async () => {
  const { createNodeWorkerProvider } = await import('@poe-platform/safe-bash/commands/node/host');
  const provider = createNodeWorkerProvider({ entry: new URL('./node-optional-limits-adapter.ts', import.meta.url).href, identity: 'optional-transport-fixture' });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ provider, grants: { dataRead: true, jsonModules: true, stdoutWrite: true } }));
  const source = ' '.repeat(70_000);
  try {
    const result = await shell.exec(`node -e '${source}'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, source.length * 140);
  } finally { await shell.dispose(); }
});

test('explicit memory budgets may exceed the former ceiling and release reusable capacity', async () => {
  const { NodeLedger } = await import('../../src/commands/node/values.js');
  const { resolveNodeLimits } = await import('../../src/commands/node/types.js');
  const size = 17 * 1024 * 1024;
  const unlimited = new NodeLedger();
  unlimited.reserve('large', size)();
  const bounded = new NodeLedger(resolveNodeLimits({ memoryBytes: size }));
  const release = bounded.reserve('large', size);
  assert.throws(() => bounded.reserve('additional', 1), /command-owned memory/);
  release();
  bounded.reserve('reused', size)();
});

test('provider reservation labels have no implicit metadata size cap', async () => {
  const { NodeLedger } = await import('../../src/commands/node/values.js');
  const ledger = new NodeLedger();
  ledger.reserve('x'.repeat(1000), 1)();
});
