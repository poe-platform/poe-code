import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createDos2unixCommand, createUnix2dosCommand, type LineEndingLimits } from "../../../src/commands/line-endings/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function view(memory: MemoryFileSystem, overrides: object): FileSystem {
  return new Proxy(memory, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

for (const [name, create] of [['dos2unix', createDos2unixCommand], ['unix2dos', createUnix2dosCommand]] as const) {
  async function run(overrides: Partial<CommandContext> = {}, limits: Partial<LineEndingLimits> = {}) {
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await create({ limits }).execute({ command: name, args: [], fs: new MemoryFileSystem(), cwd: '/', env: { LC_ALL: 'C.UTF-8' }, signal: new AbortController().signal,
      stdin: toByteSource('A\r\n'), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides });
    return { ...result, stdout: Buffer.concat(stdout).toString('hex'), stderr: Buffer.concat(stderr).toString() };
  }

  test(`${name}: chunk copy must not consult producer iterator`, async () => {
    let calls = 0;
    const bytes = Uint8Array.of(65, 13, 10);
    Object.defineProperty(bytes, Symbol.iterator, { value: function* () { calls++; yield 66; yield 10; } });
    const result = await run({ stdin: { async *[Symbol.asyncIterator]() { yield bytes; } } });
    assert.equal(calls, 0);
    assert.equal(result.stdout, name === 'dos2unix' ? '410a' : '410d0a');
  });

  test(`${name}: intrinsic chunk extent is charged despite own length`, async () => {
    const bytes = Uint8Array.of(65, 13, 10);
    Object.defineProperty(bytes, 'length', { value: 0 });
    const result = await run({ stdin: { async *[Symbol.asyncIterator]() { yield bytes; } } }, { maxInputBytes: 2 });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /input bytes limit exceeded/);
    assert.equal(result.stdout, '');
  });

  test(`${name}: readFile extent cannot bypass fallback admission`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile('/in', Buffer.from('A\r\n'));
    const bytes = Uint8Array.of(65, 13, 10);
    Object.defineProperty(bytes, 'length', { value: 0 });
    const fs = view(memory, {
      capabilitiesFor: async () => ({ ...memory.capabilities, streamingRead: false }),
      lstat: async (path: string) => ({ ...await memory.lstat(path), ...(path === '/in' ? { size: 0 } : {}) }),
      readFile: async () => bytes,
    });
    const result = await run({ args: ['-q', 'in'], fs }, { maxInputBytes: 2 });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(await memory.readFile('/in')).toString(), 'A\r\n');
    assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['in']);
  });

  test(`${name}: producer reuse leaves owned prefix intact`, async () => {
    const bytes = Uint8Array.of(65, 13);
    const result = await run({ stdin: { async *[Symbol.asyncIterator]() { try { yield bytes; bytes.set([10, 66]); yield bytes; } finally { bytes.fill(0); } } } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, name === 'dos2unix' ? '410a42' : '410d0a42');
  });

  for (const reason of [false, 0, '', null]) test(`${name}: next getter cancellation drains the acquired receiver (${JSON.stringify(reason)})`, async () => {
    const caller = new AbortController();
    const entered = deferred(), released = deferred();
    let nextCalls = 0, returns = 0, settled = false;
    const iterator = {
      get next() { caller.abort(reason); return async function () { nextCalls++; return { done: true as const, value: undefined }; }; },
      async return() { assert.equal(this, iterator); returns++; entered.resolve(); await released.promise; return { done: true as const, value: undefined }; },
    };
    const execution = run({ signal: caller.signal, stdin: { [Symbol.asyncIterator]() { return iterator; } } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      await setImmediate();
      assert.equal(nextCalls, 0); assert.equal(returns, 1); assert.equal(settled, false);
      released.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
    } finally { released.resolve(); await execution.catch(() => {}); }
  });

  for (const capability of ['atomicRename', 'exclusiveCreate', 'permissions']) test(`${name}: missing ${capability} refuses publication without staging`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile('/in', Buffer.from('A\r\n'));
    const fs = view(memory, { capabilitiesFor: async () => ({ ...memory.capabilities, [capability]: false }) });
    const result = await run({ args: ['in'], fs });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(await memory.readFile('/in')).toString(), 'A\r\n');
    assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['in']);
  });

  test(`${name}: failed rename preserves destination and removes known stage`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile('/in', Buffer.from('A\r\n'));
    const failure = new Error('bounded rename failure');
    const fs = view(memory, { rename: async () => { throw failure; } });
    await assert.rejects(run({ args: ['in'], fs }), error => error === failure);
    assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['in']);
    assert.equal(Buffer.from(await memory.readFile('/in')).toString(), 'A\r\n');
  });

  test(`${name}: cleanup never deletes replacement of stage identity`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile('/in', Buffer.from('A\r\n'));
    const failure = new Error('bounded stage replacement');
    let temporary = '';
    const fs = view(memory, { appendFile: async (path: string) => { temporary = path; await memory.rm(path); await memory.writeFile(path, Buffer.from('foreign')); throw failure; } });
    await assert.rejects(run({ args: ['in'], fs }), error => error === failure);
    assert.equal(Buffer.from(await memory.readFile(temporary)).toString(), 'foreign');
    assert.equal(Buffer.from(await memory.readFile('/in')).toString(), 'A\r\n');
  });

  test(`${name}: input path replacement before publication is not overwritten`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile('/in', Buffer.from('A\r\n'));
    const fs = view(memory, { readStream: () => ({ async *[Symbol.asyncIterator]() { yield Uint8Array.of(65, 13, 10); await memory.rm('/in'); await memory.writeFile('/in', Buffer.from('foreign')); } }) });
    const result = await run({ args: ['in'], fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /destination changed/);
    assert.equal(Buffer.from(await memory.readFile('/in')).toString(), 'foreign');
    assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['in']);
  });
}
