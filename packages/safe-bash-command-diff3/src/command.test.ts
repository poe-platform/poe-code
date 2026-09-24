import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { createDiff3Command, diff3 } from './command.js';
import { Diff3Error } from './contracts.js';

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
function fixture(args = ['-m', 'ours', 'base', 'theirs']) {
  const files: Record<string, Uint8Array> = { '/vfs/ours': encode('a\nours\nz\n'), '/vfs/base': encode('a\nbase\nz\n'), '/vfs/theirs': encode('a\ntheirs\nz\n') };
  const stdout: number[] = [], stderr: number[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const controller = new AbortController(), carrier = createCommandArguments(args);
  let reads = 0, returns = 0;
  const context = {
    command: 'diff3', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {}, signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() { reads++; return { async next() { return { done: true as const, value: undefined }; }, async return() { returns++; return { done: true as const, value: undefined }; } }; } },
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: { readStream(path: string, options: { signal: AbortSignal }) {
      assert.ok(cleanups.length); reads++;
      return (async function* () {
        try {
          options.signal.throwIfAborted();
          if (path === '/vfs/directory') throw new FsError('EISDIR', { path });
          const bytes = files[path === '/vfs/alias' ? '/vfs/ours' : path];
          if (!bytes) throw new FsError('ENOENT', { path });
          for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1);
        } finally { returns++; }
      })();
    } },
  } as unknown as CommandContext;
  return { context, controller, stdout, stderr, files, cleanups, reads: () => reads, returns: () => returns };
}
test('CLI and SDK use the same modes and VFS aliases without modifying inputs', async () => {
  const cli = fixture(['-mE', 'alias', 'base', 'theirs']), sdk = fixture();
  const before = sdk.files['/vfs/ours']!.slice();
  const a = await createDiff3Command().execute(cli.context);
  const b = await diff3(sdk.context, { files: ['alias', 'base', 'theirs'], merge: true, selector: 'E' });
  assert.equal(a.exitCode, 1); assert.equal(b.exitCode, 1); assert.deepEqual(cli.stdout, sdk.stdout);
  assert.equal(b.accounting.inputBytes, 29); assert.equal(b.accounting.retainedBytes, 0);
  assert.deepEqual(sdk.files['/vfs/ours'], before);
  await Promise.all([...cli.cleanups, ...sdk.cleanups].map(cleanup => cleanup()));
});
test('one stdin in every position is spooled once; multiple stdin and options fail before I/O', async () => {
  for (let index = 0; index < 3; index++) {
    const paths = ['ours', 'base', 'theirs']; paths[index] = '-';
    const f = fixture(['-m', ...paths]); let consumed = 0;
    const context = { ...f.context, stdin: (async function* () { consumed++; yield f.files[`/vfs/${['ours', 'base', 'theirs'][index]}`]!; })() };
    assert.equal((await createDiff3Command().execute(context)).exitCode, 1); assert.equal(consumed, 1);
    assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)).includes('<<<<<<<'), true);
  }
  for (const args of [['-m', '-', '-', 'theirs'], ['--diff-program=x', 'ours', 'base', 'theirs'], ['-i', '-m', 'ours', 'base', 'theirs']]) {
    const f = fixture(args); assert.equal((await createDiff3Command().execute(f.context)).exitCode, 2); assert.equal(f.reads(), 0); assert.equal(f.stdout.length, 0);
  }
});
test('SDK rejects invalid empty selector and information values before I/O', async () => {
  for (const invalid of [{ selector: '' }, { information: '' }]) {
    const f = fixture();
    const result = await diff3(f.context, { files: ['ours', 'base', 'theirs'], ...invalid } as never);
    assert.equal(result.exitCode, 2);
    assert.equal(f.reads(), 0);
    assert.equal(f.stdout.length, 0);
  }
});
test('CLI and SDK reject unpaired surrogate metadata before I/O and retain valid pairs', async () => {
  for (const value of ['\ud800', '\udc00', 'x\ud800y', '\ud800\ud800']) {
    for (const label of [false, true]) {
      const files = [label ? 'ours' : value, 'base', 'theirs'];
      const cli = fixture(['-m', ...(label ? ['-L', value] : []), ...files]), sdk = fixture();
      const a = await createDiff3Command().execute(cli.context);
      const b = await diff3(sdk.context, { files, merge: true, ...(label ? { labels: [value] } : {}) });
      assert.equal(a.exitCode, 2); assert.equal(b.exitCode, 2);
      assert.equal(cli.reads(), 0); assert.equal(sdk.reads(), 0);
      assert.deepEqual(cli.stderr, sdk.stderr);
    }
  }
  const cli = fixture(['-mL\ud83d\ude00', 'ours', 'base', 'theirs']), sdk = fixture();
  assert.equal((await createDiff3Command().execute(cli.context)).exitCode, 1);
  assert.equal((await diff3(sdk.context, { files: ['ours', 'base', 'theirs'], merge: true, labels: ['\ud83d\ude00'] })).exitCode, 1);
  assert.deepEqual(cli.stdout, sdk.stdout);
});
test('directory, spool and output quota failures return 2 without publishing stdout', async () => {
  for (const [args, limits] of [[['-m', 'directory', 'base', 'theirs'], {}], [['-m', 'ours', 'base', 'theirs'], { inputBytes: 1 }], [['-m', 'ours', 'base', 'theirs'], { outputBytes: 32 }], [['-m', 'ours', 'base', 'theirs'], { retainedBytes: 256 }]] as const) {
    const f = fixture([...args]); assert.equal((await createDiff3Command({ limits }).execute(f.context)).exitCode, 2); assert.equal(f.stdout.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
test('pre-abort preserves falsey reasons and performs no I/O', async () => {
  const f = fixture(); f.controller.abort(0);
  await assert.rejects(Promise.resolve(createDiff3Command().execute(f.context)), (reason: unknown) => reason === 0); assert.equal(f.reads(), 0); assert.equal(f.stdout.length, 0);
});
test('cancellation during read returns iterator and releases owned spool', async () => {
  const f = fixture(['-m', '-', 'base', 'theirs']); let closed = 0;
  const context = { ...f.context, stdin: { [Symbol.asyncIterator]() { return {
    async next() { f.controller.abort(false); return { done: false as const, value: encode('x') }; },
    async return() { closed++; return { done: true as const, value: undefined }; }
  }; } } };
  await assert.rejects(Promise.resolve(createDiff3Command().execute(context)), (reason: unknown) => reason === false); assert.equal(closed, 1);
  await Promise.all(f.cleanups.map(cleanup => cleanup())); assert.equal(f.stdout.length, 0);
});
test('SDK snapshots operands before yielding and cross-realm bytes remain bytes', async () => {
  const f = fixture(); const files = ['ours', 'base', 'theirs'];
  f.files['/vfs/ours'] = runInNewContext('Uint8Array.of(255, 10)') as Uint8Array;
  const pending = diff3(f.context, { files, merge: true }); files[0] = 'missing';
  assert.equal((await pending).exitCode, 1); assert.ok(f.stdout.includes(255));
});
test('sink errors preserve canonical identity, without another write', async () => {
  const f = fixture(), failure = new FsError('EPIPE', { syscall: 'write' });
  let writes = 0;
  const context = { ...f.context, stdout: { async write() { writes++; throw failure; } } };
  await assert.rejects(Promise.resolve(createDiff3Command().execute(context)), reason => reason === failure);
  assert.equal(writes, 1); assert.equal(f.stderr.length, 0);
});
test('late VFS resolution is drained by invocation cleanup after cancellation', async () => {
  const f = fixture(); let resolve!: (bytes: Uint8Array) => void, started!: () => void;
  const admitted = new Promise<void>(done => { started = done; });
  const context = { ...f.context, fs: { async readFile(_path: string, options: { signal: AbortSignal; maxBytes: number }) {
    assert.ok(options.signal); assert.equal(options.maxBytes, undefined); started();
    return new Promise<Uint8Array>(done => { resolve = done; });
  } } } as unknown as CommandContext;
  const pending = Promise.resolve(createDiff3Command().execute(context));
  await admitted; f.controller.abort('cancelled');
  let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  resolve(encode('late\n'));
  await assert.rejects(pending, reason => reason === 'cancelled');
  await Promise.all(f.cleanups.map(cleanup => cleanup())); assert.equal(f.stdout.length, 0);
});
test('SDK limits are snapshotted; owned writes drain on cancellation', async () => {
  const f = fixture(), consumer = new AbortController(); let finish!: () => void, began!: () => void;
  const started = new Promise<void>(done => { began = done; });
  const limits = { inputBytes: 1000 };
  const context = { ...f.context, stdout: { async write() { throw new Error('Owned route required'); }, ownedOutput: {
    consumerClosed: consumer.signal, async write() { began(); await new Promise<void>(done => { finish = done; }); }
  } } };
  const pending = diff3(context, { files: ['ours', 'base', 'theirs'], merge: true, limits }); limits.inputBytes = 0;
  await started; f.controller.abort(null); finish();
  await assert.rejects(pending, reason => reason === null);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});
test('exhausted diagnostic budgets still report status 2 and an SDK error', async () => {
  const f = fixture();
  const result = await diff3(f.context, { files: ['ours', 'base', 'theirs'], merge: true, limits: { work: 0, outputBytes: 0, retainedBytes: 0 } });
  assert.equal(result.exitCode, 2); assert.ok(result.error); assert.equal(result.accounting.outputBytes, 0); assert.equal(result.accounting.work, 0);
  assert.equal(f.reads(), 0); assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
});
test('cleanup registration can close admission synchronously before the task begins', async () => {
  const f = fixture(); let closed: Promise<void> | undefined;
  const context = { ...f.context, registerCleanup(cleanup: () => void | Promise<void>) { closed = Promise.resolve(cleanup()); } };
  const pending = Promise.resolve(createDiff3Command().execute(context));
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === 'Diff3 invocation closed');
  await closed; assert.equal(f.reads(), 0);
});
test('empty stream chunks consume work without retaining spool fragments', async () => {
  const f = fixture(['ours', 'base', 'theirs']);
  const context = { ...f.context, fs: { readStream() { return (async function* () { for (let i = 0; i < 100; i++) yield new Uint8Array(); })(); } } } as unknown as CommandContext;
  const result = await diff3(context, { files: ['ours', 'base', 'theirs'], limits: { graphCells: 40, work: 10000, retainedBytes: 2000 } });
  assert.equal(result.exitCode, 0); assert.equal(result.accounting.inputBytes, 0); assert.equal(result.accounting.retainedBytes, 0); assert.ok(result.accounting.work >= 300);
});
test('external diagnostic text cannot inject terminal controls', async () => {
  const f = fixture(), error = new Diff3Error('STATE', 'path \u001b[31m\nforged');
  const context = { ...f.context, fs: { readStream() { return (async function* () { yield new Uint8Array(); throw error; })(); } } } as unknown as CommandContext;
  const result = await diff3(context, { files: ['ours', 'base', 'theirs'] });
  assert.equal(result.exitCode, 2); assert.equal(result.error, error);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), 'diff3: path \\u001b[31m\\u000aforged\n');
});

test('reused producer buffers are copied before advancing, including shadowed lengths', async () => {
  const f = fixture();
  const context = { ...f.context, fs: { readStream(path: string) {
    return (async function* () {
      const storage = new Uint8Array(1);
      Object.defineProperty(storage, 'length', { value: 0 });
      for (const byte of f.files[path]!) { storage[0] = byte; yield storage; }
      storage[0] = 0;
    })();
  } } } as unknown as CommandContext;
  const result = await createDiff3Command().execute(context);
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)), 'a\n<<<<<<< ours\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> theirs\nz\n');
  assert.equal((result as Awaited<ReturnType<typeof diff3>>).accounting.inputBytes, 29);
});

test('fragment and empty-chunk work quotas close hostile producers exactly once', async () => {
  for (const empty of [false, true]) {
    const f = fixture(['-m', '-', 'base', 'theirs']); let closed = 0, nexts = 0;
    const context = { ...f.context, stdin: { [Symbol.asyncIterator]() { return {
      async next() { nexts++; return { done: false as const, value: empty ? new Uint8Array() : Uint8Array.of(97) }; },
      async return() { closed++; return { done: true as const, value: undefined }; }
    }; } } };
    const result = await diff3(context, { files: ['-', 'base', 'theirs'], merge: true, limits: { graphCells: 16, work: 1000 } });
    assert.equal(result.exitCode, 2); assert.equal(result.error?.code, 'LIMIT');
    assert.equal(result.accounting.retainedBytes, 0); assert.equal(f.stdout.length, 0);
    assert.equal(closed, 1); assert.ok(nexts < 1001);
    await Promise.all(f.cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(closed, 1);
  }
});

test('read failure and failing iterator cleanup are both preserved', async () => {
  const f = fixture(), readFailure = new FsError('EIO'), closeFailure = new Error('close failed');
  let closed = 0;
  const context = { ...f.context, stdin: { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw readFailure; },
    async return(): Promise<IteratorResult<Uint8Array>> { closed++; throw closeFailure; }
  }; } } };
  await assert.rejects(diff3(context, { files: ['-', 'base', 'theirs'] }), error => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.includes(readFailure)); assert.ok(error.errors.includes(closeFailure)); return true;
  });
  assert.equal(closed, 1); assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test('a sink may publish a prefix before failing; cleanup provides no rollback', async () => {
  const f = fixture(), failure = new FsError('ENOSPC'); let writes = 0;
  const context = { ...f.context, stdout: { async write(bytes: Uint8Array) {
    writes++; f.stdout.push(...bytes.subarray(0, 5)); throw failure;
  } } };
  await assert.rejects(diff3(context, { files: ['ours', 'base', 'theirs'], merge: true }), reason => reason === failure);
  assert.equal(writes, 1); assert.deepEqual(f.stdout, Array.from(encode('a\n<<<'))); assert.equal(f.stderr.length, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test('cancellation during SDK metadata admission closes the invocation before VFS reads', async () => {
  const f = fixture(), labels = ['label'];
  Object.defineProperty(labels, '0', { get() { f.controller.abort(false); return 'label'; } });
  await assert.rejects(diff3(f.context, { files: ['ours', 'base', 'theirs'], merge: true, labels }), reason => reason === false);
  assert.equal(f.reads(), 0); assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});
