import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { diff3 } from './command.js';
import { compareDiff3 } from './behavior.js';
import type { CommandContext } from 'safe-bash-contracts/command';

test('fallback payloads and output pages share the invocation retention quota', async () => {
  const fs = createMemoryFileSystem();
  for (const path of ['/ours', '/base', '/theirs']) await fs.writeFile(path, new Uint8Array(1100000).fill(120));
  const fallback = new Proxy(fs, { get(target, key) {
    if (key === 'readStream' || key === 'openReadFile') return undefined;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const context: CommandContext = { command: 'diff3', args: [], cwd: '/', env: {}, fs: fallback,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() { assert.fail('quota failure must not publish stdout'); } }, stderr: { async write() {} },
  };
  const result = await diff3(context, { files: ['ours', 'base', 'theirs'], merge: true, limits: { retainedBytes: 1200000 } });
  assert.equal(result.exitCode, 2); assert.equal(result.error?.code, 'LIMIT');
  assert.ok(result.accounting.peakRetainedBytes <= 1200000);
  const help = await diff3(context, { files: [], information: 'help', limits: { retainedBytes: 64 } });
  assert.equal(help.exitCode, 2); assert.equal(help.error?.code, 'LIMIT');
});

test('diff3 rejects retained-source revision changes before output', async () => {
  const fs = createMemoryFileSystem();
  for (const path of ['/ours', '/base', '/theirs']) await fs.writeFile(path, new TextEncoder().encode('old\n'));
  let closed = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof fs.openReadFile>) => {
      const handle = await target.openReadFile(...args);
      return { ...handle,
        async read(...params: Parameters<typeof handle.read>) {
          const bytes = await handle.read(...params);
          await fs.writeFile(args[0], new TextEncoder().encode('external\n'));
          return bytes;
        },
        async close() { closed++; await handle.close(); },
      };
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const result = await diff3({ command: 'diff3', args: [], cwd: '/', env: {}, fs: view,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() { assert.fail('stale input must not publish output'); } }, stderr: { async write() {} },
  }, { files: ['ours', 'base', 'theirs'], merge: true });
  assert.equal(result.exitCode, 2); assert.equal(result.error?.code, 'STATE');
  assert.equal(closed, 1);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['base', 'ours', 'theirs']);
});

for (const merge of [false, true]) test(`diff3 uses caller storage and bounded output: merge=${merge}`, async () => {
  const fs = createMemoryFileSystem();
  const block = new Uint8Array(16384).fill(120);
  for (const path of ['/ours', '/base', '/theirs']) await fs.writeStream(path, { async *[Symbol.asyncIterator]() {
    for (let i = 0; i < 24; i++) yield block;
    yield new TextEncoder().encode(path === '/theirs' ? '\nnew\n' : '\nold\n');
  } });
  let storage = 0, pending = 0, maximum = 0;
  const output: Uint8Array[] = [];
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'readFile') return () => assert.fail('payload-wide reads are forbidden');
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => { storage++; return target.open(...args); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const result = await diff3({ command: 'diff3', args: [], cwd: '/', env: {}, fs: view,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) {
      pending += bytes.length; maximum = Math.max(maximum, pending);
      await Promise.resolve(); output.push(bytes.slice()); pending -= bytes.length;
    } }, stderr: { async write() { assert.fail('unexpected diagnostic'); } },
  } satisfies CommandContext, { files: ['ours', 'base', 'theirs'], merge });
  assert.equal(result.exitCode, 0);
  assert.ok(storage > 0, 'document payloads must spill through injected storage');
  assert.ok(maximum <= 16384); assert.equal(pending, 0);
  const expected = compareDiff3(await Promise.all(['/ours', '/base', '/theirs'].map(path => fs.readFile(path))), { files: ['ours', 'base', 'theirs'], merge });
  assert.deepEqual(Buffer.concat(output), Buffer.from(expected.stdout));
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['base', 'ours', 'theirs']);
});

for (const failure of ['none', 'spill', 'read', 'write', 'cancel'] as const) test(`diff3 retires caller resources after ${failure}`, async () => {
  const fs = createMemoryFileSystem();
  const block = new Uint8Array(16384).fill(120);
  for (const path of ['/ours', '/base', '/theirs']) await fs.writeStream(path, { async *[Symbol.asyncIterator]() {
    for (let i = 0; i < 8; i++) yield block;
    yield new Uint8Array([10]);
  } });
  const controller = new AbortController(), reason = new Error('injected diff3 failure');
  let opened = 0, closed = 0, writes = 0, outstanding = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
      const handle = await target.open(...args); opened++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384);
          if (failure === 'spill') throw reason;
          return target.write(...args);
        };
        if (key === 'close') return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    if (key === 'openReadFile') return async (...args: Parameters<typeof fs.openReadFile>) => {
      const handle = await target.openReadFile(...args); opened++;
      return { ...handle,
        async read(...args: Parameters<typeof handle.read>) {
          assert.ok(args[1] <= 65536);
          if (failure === 'read') throw reason;
          return handle.read(...args);
        },
        async close() { closed++; return handle.close(); },
      };
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const operation = diff3({ command: 'diff3', args: [], cwd: '/', env: {}, fs: view,
    signal: controller.signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) {
      outstanding += bytes.length; assert.ok(outstanding <= 16384);
      try {
        await Promise.resolve();
        if (++writes === 3) {
          if (failure === 'write') throw reason;
          if (failure === 'cancel') controller.abort(reason);
        }
      } finally { outstanding -= bytes.length; }
    } }, stderr: { async write() { assert.fail('unexpected diagnostic'); } },
  }, { files: ['ours', 'base', 'theirs'], merge: true });
  if (failure === 'none') assert.equal((await operation).exitCode, 0);
  else await assert.rejects(operation, error => error === reason);
  assert.equal(opened, closed); assert.equal(outstanding, 0);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['base', 'ours', 'theirs']);
});
