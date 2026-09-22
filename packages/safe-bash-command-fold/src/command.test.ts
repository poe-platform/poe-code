import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createCommandArguments, CommandRegistry, type CommandContext } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { createFoldCommand, fold, foldCommands } from './command.js';
import { FoldError } from './contracts.js';
const encoder = new TextEncoder();
function fixture(args: readonly string[] = [], input = '', files: Record<string, string> = {}) {
  const stdout: number[] = [], stderr: number[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {},
    signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: { readStream(path: string, options: { signal: AbortSignal }) {
      assert.ok(cleanups.length); assert.ok(options.signal);
      return (async function* () {
        if (!(path in files)) throw new FsError('ENOENT', { path });
        yield encoder.encode(files[path]);
      })();
    } },
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups, text: () => new TextDecoder().decode(Uint8Array.from(stdout)) };
}
test('CLI and SDK have equivalent byte-mode wrapping and typed counters', async () => {
  const cli = fixture(['-sb', '--wid=5'], '界界界\n');
  const sdk = fixture([], '界界界\n');
  assert.equal((await createFoldCommand().execute(cli.context)).exitCode, 0);
  const result = await fold(sdk.context, { width: 5, mode: 'bytes', spaces: true });
  assert.equal(result.exitCode, 0); assert.equal(result.filesRead, 1);
  assert.equal(result.accounting.inputBytes, 10);
  assert.equal(cli.text(), '界\n界\n界\n'); assert.deepEqual(cli.stdout, sdk.stdout);
  await Promise.all(cli.cleanups.map(cleanup => cleanup()));
});
test('released fold.pl variants agree through CLI and SDK memory input routes', async () => {
  // Fixed outputs transcribed from coreutils 9.10 tests/fold/fold.pl,
  // independent of the parser/engine. Its .p/.r input variants are mapped to
  // chunked stdin and literal VFS reads; installed QA covers actual shell pipes.
  const cases = [
    { input: 'a\t', output: 'a\n\t', args: ['-w2', '-s'], width: 2, mode: 'columns', spaces: true },
    { input: 'abcdef d\n', output: 'abcd\nef d\n', args: ['-w4', '-s'], width: 4, mode: 'columns', spaces: true },
    { input: 'a cd fgh\n', output: 'a \ncd \nfgh\n', args: ['-w4', '-s'], width: 4, mode: 'columns', spaces: true },
    { input: 'abc ef\n', output: 'abc \nef\n', args: ['-w4', '-s'], width: 4, mode: 'columns', spaces: true },
    { input: 'abcdef\nghijkl', output: 'abcd\nef\nghij\nkl', args: ['-b', '-w4'], width: 4, mode: 'bytes', spaces: false },
    { input: '1234567890\nabcdefghij\n1234567890', output: '123456\n7890\nabcdef\nghij\n123456\n7890', args: ['-b', '-w6'], width: 6, mode: 'bytes', spaces: false },
    { input: 'ééé', output: 'éé\né', args: ['-w2'], width: 2, mode: 'columns', spaces: false },
    { input: 'e\u0301e\u0301e\u0301', output: 'e\u0301e\u0301\ne\u0301', args: ['-w2'], width: 2, mode: 'columns', spaces: false },
    { input: 'ｅｅ', output: 'ｅ\nｅ', args: ['-w2'], width: 2, mode: 'columns', spaces: false },
  ] as const;
  let executions = 0;
  for (const locale of ['C', 'UTF-8/Unicode-17.0.0'] as const) {
    for (const entry of cases) {
      if (locale === 'C' && entry.input.codePointAt(0)! > 127) continue;
      if (locale === 'C' && entry.input.includes('\u0301')) continue;
      for (const route of ['stdin', 'chunked-stdin', 'file'] as const) {
        for (const sdk of [false, true]) {
          const f = fixture([...entry.args, ...(route === 'file' ? ['--', '-literal'] : [])], entry.input, { '/vfs/-literal': entry.input });
          const context = route === 'chunked-stdin' ? { ...f.context, stdin: (async function* () {
            for (const byte of encoder.encode(entry.input)) yield Uint8Array.of(byte);
          })() } : f.context;
          const result = sdk
            ? await fold(context, { locale, width: entry.width, mode: entry.mode, spaces: entry.spaces, files: route === 'file' ? ['-literal'] : [] })
            : await createFoldCommand({ locale }).execute(context);
          assert.equal(result.exitCode, 0, `${locale} ${route} SDK=${sdk} ${entry.args.join(' ')}`);
          assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode(entry.output));
          assert.equal(f.stderr.length, 0);
          await Promise.all(f.cleanups.map(cleanup => cleanup()));
          executions++;
        }
      }
    }
  }
  assert.equal(executions, 90);
});
test('literal files, stdin, file errors and cross-file prior width are preserved', async () => {
  const f = fixture(['-w7', 'first', 'missing', '--', '-literal', '-'], 'xyz', { '/vfs/first': '界\n', '/vfs/-literal': '\t\bABCDE\n' });
  assert.equal((await createFoldCommand().execute(f.context)).exitCode, 1);
  assert.equal(f.text(), '界\n\t\bA\nBCDE\nxyz');
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), "fold: 'missing': No such file or directory\n");
});
test('unknown options fail explicitly without consuming stdin', async () => {
  const f = fixture(['--unknown'], 'abc');
  assert.equal((await createFoldCommand().execute(f.context)).exitCode, 1);
  assert.equal(f.text(), ''); assert.match(new TextDecoder().decode(Uint8Array.from(f.stderr)), /Unavailable option/);
});
test('CLI and SDK admit cross-realm byte storage on every memory input route', async () => {
  for (const route of ['stdin', 'stream', 'file'] as const) {
    for (const sdk of [false, true]) {
      const bytes = runInNewContext('Uint8Array.of(120, 97, 98, 99, 100, 101, 102, 120).subarray(1, 7)') as Uint8Array;
      Object.defineProperty(bytes, 'byteLength', { get() { throw new Error('Producer byteLength accessed'); } });
      Object.defineProperty(bytes, Symbol.iterator, { value: function* () { yield 120; } });
      const f = fixture(['-w3', ...(route === 'stdin' ? [] : ['input'])]);
      const source = (async function* () { yield bytes; bytes.fill(120); })();
      const context = { ...f.context,
        ...(route === 'stdin' ? { stdin: source } : { fs: route === 'stream'
          ? { readStream(_path: string, options: { signal: AbortSignal }) { assert.ok(options.signal); return source; } }
          : { async readFile(_path: string, options: { signal: AbortSignal }) { assert.ok(options.signal); return bytes; } } }),
      } as CommandContext;
      const result = sdk ? await fold(context, { width: 3, files: route === 'stdin' ? [] : ['input'] })
        : await createFoldCommand().execute(context);
      assert.equal(result.exitCode, 0, `${route} SDK=${sdk}`);
      bytes.fill(120);
      assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode('abc\ndef'));
      assert.equal(f.stderr.length, 0);
      await Promise.all(f.cleanups.map(cleanup => cleanup()));
    }
  }
});
test('input view admission rejects fake, non-byte and detached storage and closes once', async () => {
  const detached = Uint8Array.of(97);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const bytes of [new Uint16Array([97]), new DataView(new ArrayBuffer(1)), detached,
    new Proxy(Uint8Array.of(97), {}), { [Symbol.toStringTag]: 'Uint8Array', buffer: new ArrayBuffer(1), byteLength: 1, byteOffset: 0 }]) {
    const f = fixture(['-w3']);
    let closes = 0;
    const context = { ...f.context, stdin: { [Symbol.asyncIterator]() { return {
      async next() { return { done: false as const, value: bytes as Uint8Array }; },
      async return() { closes++; return { done: true as const, value: undefined }; },
    }; } } };
    await assert.rejects(createFoldCommand().execute(context) as Promise<unknown>, error =>
      error instanceof FoldError && error.code === 'INPUT');
    assert.equal(closes, 1); assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
test('borrowed cross-realm text encoding preserves deterministic diagnostics', async () => {
  const f = fixture(['--unknown']);
  const original = globalThis.TextEncoder;
  globalThis.TextEncoder = class extends original {
    override encode(input = ''): Uint8Array<ArrayBuffer> {
      return runInNewContext(`Uint8Array.from(${JSON.stringify([...super.encode(input)])})`) as Uint8Array<ArrayBuffer>;
    }
  };
  try {
    assert.equal((await createFoldCommand().execute(f.context)).exitCode, 1);
    assert.deepEqual(Uint8Array.from(f.stderr), encoder.encode('fold: Unavailable option: --unknown\n'));
    assert.equal(f.stdout.length, 0);
  } finally { globalThis.TextEncoder = original; }
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});
test('argument admission bounds string scanning before CLI and SDK byte measurement', async () => {
  for (const sdk of [false, true]) {
    const file = 'x'.repeat(33);
    const f = fixture(sdk ? [] : [file]);
    const original = String.prototype[Symbol.iterator];
    let visited = 0;
    String.prototype[Symbol.iterator] = function () {
      const iterator = original.call(this);
      const next = iterator.next.bind(iterator);
      iterator.next = () => { const result = next(); if (!result.done) visited++; return result; };
      return iterator;
    };
    try {
      const limits = { argumentBytes: 32 };
      const result = sdk ? await fold(f.context, { limits, files: [file] })
        : await createFoldCommand({ limits }).execute(f.context);
      assert.equal(result.exitCode, 1);
      assert.ok(visited <= limits.argumentBytes, `scanned ${visited} string characters before admission`);
      assert.equal(f.stdout.length, 0);
      assert.match(new TextDecoder().decode(Uint8Array.from(f.stderr)), /Argument byte limit exceeded/);
    } finally { String.prototype[Symbol.iterator] = original; }
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
test('plugin is opt-in and refuses collisions', () => {
  const commands = new CommandRegistry();
  const host = { commands } as Parameters<ReturnType<typeof foldCommands>['setup']>[0];
  foldCommands().setup(host); assert.equal(commands.get('fold')?.name, 'fold');
  assert.throws(() => foldCommands().setup(host), /already registered/);
  foldCommands({ replace: true }).setup(host);
});
test('producer reuse and cancellation preserve ownership and abort reason', async () => {
  const f = fixture(['-w3']); const chunk = encoder.encode('abcdef');
  const controller = new AbortController(); const reason = new Error('stop');
  const context = { ...f.context, signal: controller.signal, stdin: (async function* () { yield chunk; chunk.fill(120); controller.abort(reason); yield chunk; })() };
  await assert.rejects(createFoldCommand().execute(context) as Promise<unknown>, error => error === reason);
  assert.equal(f.text(), 'abc\n');
});
test('registered cleanup cancels and drains an admitted cooperative VFS read', async () => {
  const f = fixture(['file']);
  let started!: () => void; const acquired = new Promise<void>(resolve => { started = resolve; });
  let released = false;
  const context = { ...f.context, fs: { readStream(_path: string, { signal }: { signal: AbortSignal }) {
    return (async function* () {
      started();
      try { await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); yield new Uint8Array(); }
      finally { released = true; }
    })();
  } } as unknown as CommandContext['fs'] };
  const running = createFoldCommand().execute(context) as Promise<unknown>;
  const observed = assert.rejects(running);
  await acquired; await f.cleanups[0]!(); await observed;
  assert.equal(released, true); await f.cleanups[0]!();
});
test('caller cancellation wins while registered cleanup drains producer finally', async () => {
  const f = fixture();
  const controller = new AbortController(), reason = new Error('caller cancelled during cleanup');
  let acquired!: () => void, closing!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  const draining = new Promise<void>(resolve => { closing = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const context = { ...f.context, signal: controller.signal, fs: {
    readStream(_path: string, { signal }: { signal: AbortSignal }) {
      return (async function* () {
        acquired();
        try {
          await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
          yield new Uint8Array();
        } finally { closing(); await barrier; }
      })();
    },
  } } as unknown as CommandContext;
  const running = fold(context, { files: ['file'] });
  const observed = assert.rejects(running, error => error === reason);
  await started;
  const cleanup = f.cleanups[0]!();
  await draining;
  controller.abort(reason);
  release();
  await Promise.all([cleanup, observed]);
  assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
});
test('reentrant cleanup shares the same invocation completion', async () => {
  const f = fixture(['file']);
  let acquired!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  let reentrant: void | Promise<void>;
  const context = { ...f.context, fs: { readStream(_path: string, { signal }: { signal: AbortSignal }) {
    return (async function* () {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reentrant = f.cleanups[0]!();
          reject(signal.reason);
        }, { once: true });
        acquired();
      });
      yield new Uint8Array();
    })();
  } } as unknown as CommandContext['fs'] };
  const running = createFoldCommand().execute(context) as Promise<unknown>;
  const observed = assert.rejects(running);
  await started;
  const completion = f.cleanups[0]!();
  assert.equal(reentrant!, completion);
  await completion;
  await observed;
});
test('invalid byte argv cannot alias a literal replacement-character path', async () => {
  const f = fixture([], '', { '/vfs/�': 'secret' });
  const carrier = createCommandArguments([Uint8Array.of(255)] as never);
  const context = { ...f.context, args: carrier.args, argumentValues: carrier };
  assert.equal((await createFoldCommand().execute(context)).exitCode, 1);
  assert.equal(f.text(), '');
});
test('SDK rejects unavailable locale profiles with deterministic stderr', async () => {
  const f = fixture([], 'abc');
  assert.equal((await fold(f.context, { locale: 'ambient' as never })).exitCode, 1);
  assert.equal(f.text(), '');
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), 'fold: Unavailable locale profile: ambient\n');
});
test('diagnostics and engine output share the invocation output budget', async () => {
  const f = fixture(['missing', 'file'], '', { '/vfs/file': 'a'.repeat(50) });
  await assert.rejects(createFoldCommand({ limits: { outputBytes: 60 } }).execute(f.context) as Promise<unknown>, /Output byte limit/);
  assert.equal(f.text(), '');
});
test('argument admission and engine work share a single work budget', async () => {
  const f = fixture(['--width=80'], 'a');
  await assert.rejects(createFoldCommand({ limits: { work: 12 } }).execute(f.context) as Promise<unknown>, /work limit/i);
});
test('command admits output retention before engine output allocation', async () => {
  const f = fixture([], 'a'.repeat(4096));
  await assert.rejects(fold(f.context, { width: 1, limits: { retainedBytes: 8196 } }), /retention/i);
});
test('VFS path NUL is rejected with status one instead of an escaping error', async () => {
  const f = fixture(['a\0b']);
  assert.equal((await createFoldCommand().execute(f.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), 'fold: NUL is unavailable in VFS paths\n');
});
test('producer-owned properties cannot hide or redirect input bytes', async () => {
  const f = fixture(['-w3']);
  const bytes = encoder.encode('abcdef');
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  Object.defineProperty(bytes, 'buffer', { get() { throw new Error('producer buffer property used'); } });
  Object.defineProperty(bytes, 'byteOffset', { get() { throw new Error('producer offset property used'); } });
  Object.defineProperty(bytes, 'subarray', { value() { throw new Error('producer property used'); } });
  const context = { ...f.context, stdin: (async function* () { yield bytes; })() };
  assert.equal((await createFoldCommand().execute(context)).exitCode, 0);
  assert.equal(f.text(), 'abc\ndef');
});
test('producer species cannot replace the bytes in bounded input views', async () => {
  const f = fixture(['-w3']);
  const bytes = encoder.encode('abcdef');
  let constructions = 0;
  Object.defineProperty(bytes, 'constructor', { value: {
    [Symbol.species]: class extends Uint8Array {
      constructor(_buffer: ArrayBuffer, _offset: number, length: number) {
        super(length);
        constructions++;
        this.fill(120);
      }
    },
  } });
  const context = { ...f.context, stdin: (async function* () { yield bytes; })() };
  assert.equal((await createFoldCommand().execute(context)).exitCode, 0);
  assert.equal(f.text(), 'abc\ndef');
  assert.equal(constructions, 0);
});
test('SDK operands are owned for the invocation lifetime', async () => {
  const files = ['one', 'two'];
  const f = fixture([], '', { '/vfs/one': 'abcd', '/vfs/two': 'ok', '/vfs/secret': 'secret' });
  const context = { ...f.context, stdout: { async write(bytes: Uint8Array) { files[1] = 'secret'; await f.context.stdout.write(bytes); } } };
  assert.equal((await fold(context, { width: 2, files })).exitCode, 0);
  assert.equal(f.text(), 'ab\ncdok');
});
test('bounded readFile fallback forwards cancellation and refuses oversized storage', async () => {
  const f = fixture(['file']); let maximum = -1;
  const context = { ...f.context, fs: { async readFile(_path: string, options: { signal: AbortSignal; maxBytes: number }) {
    assert.ok(f.cleanups.length); assert.ok(options.signal); maximum = options.maxBytes;
    const bytes = encoder.encode('abcdef'); Object.defineProperty(bytes, 'byteLength', { value: 0 }); return bytes;
  } } as unknown as CommandContext['fs'] };
  await assert.rejects(createFoldCommand({ limits: { inputBytes: 3 } }).execute(context) as Promise<unknown>, /VFS input retention/);
  assert.equal(maximum, 3); assert.equal(f.text(), '');
});
test('output errors escape without being mislabeled as input file failures', async () => {
  const f = fixture(['file'], '', { '/vfs/file': 'abcdef' }); const failure = new FsError('EPIPE');
  const context = { ...f.context, stdout: { async write() { throw failure; } } };
  await assert.rejects(createFoldCommand({}).execute(context) as Promise<unknown>, error => error === failure);
  assert.equal(f.stderr.length, 0);
});
test('cleanup capability retains its host receiver when creating output scopes', async () => {
  const f = fixture([], 'abc'); let registrations = 0;
  const context: CommandContext = { ...f.context, registerCleanup() { assert.equal(this, context); registrations++; } };
  assert.equal((await createFoldCommand().execute(context)).exitCode, 0);
  assert.equal(f.text(), 'abc'); assert.equal(registrations, 3);
});
test('empty producer chunks consume bounded invocation work', async () => {
  const f = fixture();
  const context = { ...f.context, stdin: (async function* () { for (let i = 0; i < 1000; i++) yield new Uint8Array(); })() };
  await assert.rejects(createFoldCommand({ limits: { work: 20 } }).execute(context) as Promise<unknown>, /work limit/i);
});
test('detached empty producer storage keeps engine INPUT admission semantics', async () => {
  const f = fixture(); const bytes = new Uint8Array(1); structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  const context = { ...f.context, stdin: (async function* () { yield bytes; })() };
  await assert.rejects(createFoldCommand().execute(context) as Promise<unknown>, error => (error as { code?: string }).code === 'INPUT');
});
test('SDK scalar options are captured at invocation, before asynchronous I/O', async () => {
  const f = fixture([], 'abcd');
  const options = { width: 2, locale: 'C' as 'C' | 'UTF-8/Unicode-17.0.0' };
  const running = fold(f.context, options);
  options.width = 100; options.locale = 'unavailable' as never;
  assert.equal((await running).exitCode, 0); assert.equal(f.text(), 'ab\ncd');
});
test('SDK literal operands are captured before the caller can mutate them', async () => {
  const files = ['input'];
  const f = fixture([], '', { '/vfs/input': 'abcd', '/vfs/other': 'changed' });
  const running = fold(f.context, { width: 2, files });
  files[0] = 'other';
  const result = await running;
  assert.equal(result.exitCode, 0);
  assert.equal(f.text(), 'ab\ncd');
});
test('cancellation cleanup awaits asynchronous producer closure', async () => {
  const f = fixture(['file']);
  const controller = new AbortController();
  let acquired!: () => void, closing!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  const closureStarted = new Promise<void>(resolve => { closing = resolve; });
  const closureGate = new Promise<void>(resolve => { release = resolve; });
  let released = false;
  const context = { ...f.context, signal: controller.signal, fs: {
    readStream(_path: string, { signal }: { signal: AbortSignal }) {
      return (async function* () {
        try {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            acquired();
          });
          yield new Uint8Array();
        } finally { closing(); await closureGate; released = true; }
      })();
    },
  } as unknown as CommandContext['fs'] };
  const reason = new Error('cancel');
  const running = createFoldCommand().execute(context) as Promise<unknown>;
  let settled = false;
  const observed = assert.rejects(running, error => error === reason).then(() => { settled = true; });
  await started; controller.abort(reason); await closureStarted;
  // Drain queued cancellation/cleanup reactions without wall-clock timing.
  for (let i = 0; i < 50; i++) await Promise.resolve();
  try { assert.equal(settled, false); }
  finally { release(); await observed; }
  assert.equal(released, true);
  await f.cleanups[0]!();
});
test('producer close failure cannot replace a downstream failure', async () => {
  const f = fixture(['-w1']);
  const failure = new FsError('EPIPE');
  let closes = 0;
  const context = { ...f.context,
    stdin: { [Symbol.asyncIterator]() { return {
      async next() { return { done: false as const, value: encoder.encode('ab') }; },
      async return(): Promise<IteratorResult<Uint8Array>> { closes++; throw new FsError('EACCES'); },
    }; } },
    stdout: { async write() { throw failure; } },
  };
  await assert.rejects(createFoldCommand().execute(context) as Promise<unknown>, error => error === failure);
  assert.equal(closes, 1); assert.equal(f.stderr.length, 0);
});
test('falsey cancellation reasons survive producer close failures', async () => {
  for (const reason of [null, false, 0, '']) {
    const f = fixture(['-w1']); const controller = new AbortController();
    let closes = 0;
    const context = { ...f.context, signal: controller.signal,
      stdin: { [Symbol.asyncIterator]() { return {
        async next() { return { done: false as const, value: encoder.encode('ab') }; },
        async return(): Promise<IteratorResult<Uint8Array>> { closes++; throw new FsError('EACCES'); },
      }; } },
      stdout: { async write() { controller.abort(reason); } },
    };
    await assert.rejects(createFoldCommand().execute(context) as Promise<unknown>, error => error === reason);
    assert.equal(closes, 1); assert.equal(f.stderr.length, 0);
  }
});

test('live operand retention and input reservations share the invocation limit', async () => {
  for (const sdk of [false, true]) {
    const file = 'x'.repeat(3000);
    const f = fixture(sdk ? [] : [file], '', { [`/vfs/${file}`]: 'a'.repeat(4096) });
    const limits = { retainedBytes: 20000 };
    const running = sdk ? fold(f.context, { files: [file], limits })
      : createFoldCommand({ limits }).execute(f.context);
    await assert.rejects(running as Promise<unknown>, error => error instanceof FoldError && error.code === 'LIMIT');
    assert.equal(f.stdout.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test('fallback read admission deducts live operand storage before acquiring VFS bytes', async () => {
  const file = 'x'.repeat(3000);
  const f = fixture([file]);
  let maximum = -1;
  const context = { ...f.context, fs: { async readFile(_path: string, options: { maxBytes: number }) {
    maximum = options.maxBytes;
    return encoder.encode('ok');
  } } as unknown as CommandContext['fs'] };
  const result = await createFoldCommand({ limits: { retainedBytes: 20000 } }).execute(context);
  assert.equal(result.exitCode, 0);
  assert.equal(maximum, 20000 - 8196 - 3001 * 3);
  assert.equal(f.text(), 'ok');
  assert.ok((result as Awaited<ReturnType<typeof fold>>).accounting.peakRetainedBytes >= 8196 + 3001 * 3 + 8);
});

test('an input error flushes only admitted bytes and continues to the next VFS file', async () => {
  const f = fixture(['-w2', 'broken', 'next']);
  let closed = 0;
  const context = { ...f.context, fs: { readStream(path: string) { return (async function* () {
    try {
      yield encoder.encode(path.endsWith('/broken') ? 'abc' : 'XY');
      if (path.endsWith('/broken')) throw new FsError('EACCES');
    } finally { closed++; }
  })(); } } as unknown as CommandContext['fs'] };
  const result = await createFoldCommand().execute(context) as Awaited<ReturnType<typeof fold>>;
  assert.equal(result.exitCode, 1); assert.equal(result.filesFailed, 1); assert.equal(result.filesRead, 1);
  assert.equal(f.text(), 'ab\ncXY');
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), "fold: 'broken': Permission denied\n");
  assert.equal(closed, 2);
});

test('output quota failure preserves previously delivered bytes and closes input once', async () => {
  const f = fixture(['-w1']);
  let closes = 0;
  const context = { ...f.context, stdin: (async function* () {
    try { yield encoder.encode('ab'); yield encoder.encode('cd'); }
    finally { closes++; }
  })() };
  await assert.rejects(createFoldCommand({ limits: { outputBytes: 3 } }).execute(context) as Promise<unknown>,
    error => error instanceof FoldError && error.code === 'LIMIT');
  assert.equal(f.text(), 'a\n'); assert.equal(closes, 1); assert.equal(f.stderr.length, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test('stdin invocation uses no network, VFS fallback or environment capability', async t => {
  const f = fixture(['-w2'], 'abcd');
  const denied = () => { throw new Error('Denied external capability'); };
  const network = t.mock.method(globalThis, 'fetch', denied);
  const context = { ...f.context, fs: new Proxy({}, { get: denied }), env: new Proxy({}, { get: denied, ownKeys: denied }) } as CommandContext;
  assert.equal((await createFoldCommand().execute(context)).exitCode, 0);
  assert.equal(f.text(), 'ab\ncd'); assert.equal(network.mock.callCount(), 0);
});

test('cancellation during operand admission prevents VFS and output acquisition', async () => {
  const f = fixture();
  const controller = new AbortController(), reason = new Error('parse cancelled');
  const files = ['file'];
  Object.defineProperty(files, 0, { get() { controller.abort(reason); return 'file'; } });
  const context = { ...f.context, signal: controller.signal, fs: new Proxy({}, { get() { throw new Error('Unexpected VFS acquisition'); } }) } as CommandContext;
  await assert.rejects(fold(context, { files }), error => error === reason);
  assert.equal(f.stdout.length, 0); assert.equal(f.stderr.length, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});
