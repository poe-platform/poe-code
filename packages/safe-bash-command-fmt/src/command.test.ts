import assert from 'node:assert/strict';
import test from 'node:test';
import { commandRuntimeIdentity, createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { fmt, fmtCommand } from './index.js';
import { FsError } from 'safe-bash-contracts/errors';

const encoder = new TextEncoder();
function fixture(args: string[], input: string) {
  const carrier = createCommandArguments(args);
  const stdout: number[] = [], stderr: number[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  let returned = 0;
  const context = {
    command: 'fmt', args: carrier.args, argumentValues: carrier, cwd: '/', env: {},
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length, 'cleanup precedes input acquisition');
      let done = false;
      return { async next() { if (done) return { done: true, value: undefined }; done = true; return { done: false, value: encoder.encode(input) }; }, async return() { returned++; return { done: true, value: undefined }; } };
    } },
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => Promise<void>) { cleanups.push(cleanup); },
    fs: { capabilities: { read: true } },
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups, returned: () => returned };
}
test('CLI and SDK share the parser, exact 9.10 bytes and awaited writes', async () => {
  assert.equal(fmtCommand().runtimeIdentity, commandRuntimeIdentity);
  const cli = fixture(['-w8'], 'aa bb cc dd ee');
  const sdk = fixture([], 'aa bb cc dd ee');
  assert.equal((await fmtCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await fmt(sdk.context, { arguments: [encoder.encode('-w8')] })).exitCode, 0);
  assert.deepEqual(cli.stdout, [...encoder.encode('aa bb cc\ndd ee\n')]);
  assert.deepEqual(cli.stdout, sdk.stdout); assert.deepEqual(cli.stderr, []);
  await Promise.all(cli.cleanups.map(cleanup => cleanup()));
});
test('released goal range errors match CLI and SDK without acquiring input', async () => {
  for (const args of [['-g76'], ['-g20', '-w10'], ['-w10', '-g20']]) {
    for (const sdk of [false, true]) {
      const run = fixture(sdk ? [] : args, 'unused');
      let acquired = false;
      const context = { ...run.context, stdin: {
        [Symbol.asyncIterator]() { acquired = true; throw new Error('invalid goal acquired input'); },
      } };
      const result = sdk ? await fmt(context, { arguments: args.map(arg => encoder.encode(arg)) })
        : await fmtCommand().execute(context);
      assert.equal(result.exitCode, 1);
      assert.equal(acquired, false);
      assert.deepEqual(run.stdout, []);
      const value = args.includes('-g76') ? '76' : '20';
      assert.deepEqual(run.stderr, [...encoder.encode(`fmt: invalid width: '${value}': Value too large for defined data type\n`)]);
      await run.cleanups[0]!();
    }
  }
});
test('failed output retires the producer once and repeated cleanup shares completion', async () => {
  const run = fixture([], 'x'.repeat(5001));
  const failure = new Error('sink failed');
  const context = { ...run.context, stdout: { async write() { throw failure; } } };
  const result = await fmtCommand().execute(context);
  assert.equal(result.exitCode, 1);
  assert.equal(run.returned(), 1);
  const first = run.cleanups[0]!(); const second = run.cleanups[0]!();
  assert.equal(first, second); await first;
  assert.equal(run.returned(), 1);
});
test('cleanup closes resource admission without waiting for VFS metadata', async () => {
  const run = fixture(['file'], '');
  let admit!: () => void;
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let acquired = false;
  const context = { ...run.context, fs: {
    capabilities: { read: true },
    async capabilitiesFor(_path: string, options: { signal: AbortSignal }) {
      admit();
      await released;
      options.signal.throwIfAborted();
      return { read: true };
    },
    async readFile() { acquired = true; return encoder.encode('unexpected'); },
  } } as unknown as CommandContext;
  const pending = fmt(context);
  await admitted;
  let settled = false;
  const cleanup = run.cleanups[0]!();
  void cleanup.then(() => { settled = true; });
  try {
    // Metadata owns no input resource; cleanup must not depend on its cooperation.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    assert.equal(settled, true);
  } finally { release(); await cleanup; await pending; }
  assert.equal(acquired, false);
  assert.equal(run.cleanups[0]!(), cleanup);
});
test('SDK captures literal argument bytes before asynchronous acquisition', async () => {
  const run = fixture([], 'aa bb cc dd ee');
  const argument = encoder.encode('-w8');
  const pending = fmt(run.context, { arguments: [argument] });
  argument.fill(120);
  assert.equal((await pending).exitCode, 0);
  assert.deepEqual(run.stdout, [...encoder.encode('aa bb cc\ndd ee\n')]);
});
test('VFS fallback admits remaining input bytes before asking for an allocation', async () => {
  const run = fixture(['file'], '');
  let maximum: number | undefined;
  const context = { ...run.context, fs: { capabilities: { read: true },
    async readFile(_path: string, options: { maxBytes: number }) {
      maximum = options.maxBytes;
      throw new FsError('EFBIG');
    },
  } } as unknown as CommandContext;
  assert.equal((await fmt(context, { limits: { inputBytes: 1 } })).exitCode, 1);
  assert.equal(maximum, 1);
});
test('source chunk admission and fragmentation do not call producer overrides', async () => {
  const run = fixture([], '');
  const bytes = encoder.encode('one two');
  for (const property of ['length', 'byteLength', 'subarray', 'constructor']) Object.defineProperty(bytes, property, { get() { throw new Error(`Producer ${property} queried`); } });
  const context = { ...run.context, stdin: (async function* () { yield bytes; })() };
  assert.equal((await fmt(context)).exitCode, 0);
  assert.deepEqual(run.stdout, [...encoder.encode('one two\n')]);
});
test('released profile reports stdin I/O failures rather than succeeding silently', async () => {
  const run = fixture([], '');
  const context = { ...run.context, stdin: (async function* () { throw new FsError('EIO'); yield new Uint8Array(); })() };
  assert.equal((await fmt(context)).exitCode, 1);
  assert.deepEqual(run.stderr, [...encoder.encode('fmt: read error: Input/output error\n')]);
});
test('released profile reports directory read failures through VFS without changing legacy controls', async () => {
  const run = fixture(['directory'], '');
  const context = { ...run.context, fs: { capabilities: { streamingRead: true },
    readStream() { return (async function* () { throw new FsError('EISDIR'); yield new Uint8Array(); })(); },
  } } as unknown as CommandContext;
  assert.equal((await fmt(context)).exitCode, 1);
  assert.deepEqual(run.stderr, [...encoder.encode("fmt: error reading 'directory': Is a directory\n")]);
});

test('unavailable locale profiles fail equally in CLI and SDK before input acquisition', async () => {
  for (const env of [{ LC_ALL: 'invented.UTF-8' }, { LC_CTYPE: 'fr_FR.UTF-8' }, { LANG: 'host-default' }]) {
    for (const sdk of [false, true]) {
      const run = fixture([], 'one two');
      let acquired = false;
      const context = { ...run.context, env, stdin: {
        [Symbol.asyncIterator]() { acquired = true; throw new Error('unavailable profile acquired input'); },
      } };
      const result = sdk ? await fmt(context, { arguments: [] }) : await fmtCommand().execute(context);
      assert.equal(result.exitCode, 1);
      assert.equal(acquired, false);
      assert.deepEqual(run.stdout, []);
      assert.deepEqual(run.stderr, [...encoder.encode('fmt: Unavailable fmt byte/locale profile\n')]);
      await run.cleanups[0]!();
    }
  }
});
test('explicit empty SDK profile is rejected rather than selecting the default', async () => {
  for (const sdk of [false, true]) {
    const run = fixture([], '');
    let acquired = false;
    const context = { ...run.context, stdin: {
      [Symbol.asyncIterator]() { acquired = true; throw new Error('invalid profile acquired input'); },
    } };
    const options = { profile: '' as never };
    const result = sdk ? await fmt(context, options) : await fmtCommand(options).execute(context);
    assert.equal(result.exitCode, 1);
    assert.equal(acquired, false);
    assert.deepEqual(run.stderr, [...encoder.encode('fmt: Unavailable fmt byte/locale profile\n')]);
  }
});

test('available explicit locale aliases and precedence keep byte formatting independent of decoding', async () => {
  for (const env of [
    { LC_ALL: 'C', LC_CTYPE: 'invented.UTF-8' }, { LC_ALL: 'POSIX' },
    { LC_ALL: 'C.UTF-8' }, { LC_ALL: 'C.utf8' }, { LC_ALL: 'en_US.UTF-8' },
    { LC_ALL: '', LC_CTYPE: 'C', LANG: 'invented.UTF-8' },
  ]) {
    const run = fixture(['-w1'], 'é\u00a0é');
    assert.equal((await fmt({ ...run.context, env })).exitCode, 0);
    assert.deepEqual(run.stdout, [...encoder.encode('é\u00a0é\n')]);
    assert.deepEqual(run.stderr, []);
  }
});

test('file boundaries reset tab state and keep stdin separate, with identical CLI/SDK bytes', async () => {
  const args = ['first', '-', 'second', '-'];
  for (const sdk of [false, true]) {
    const run = fixture(sdk ? [] : args, 'stdin words');
    const files = new Map([
      ['/first', encoder.encode('\tone\n        two')],
      ['/second', encoder.encode('        three\n        four')],
    ]);
    const reads: string[] = [];
    const context = { ...run.context, fs: { capabilities: { read: true },
      async readFile(path: string, options: { signal: AbortSignal; maxBytes: number }) {
        options.signal.throwIfAborted(); reads.push(path);
        const bytes = files.get(path)!;
        assert.ok(bytes.length <= options.maxBytes);
        return bytes.slice();
      },
    } } as unknown as CommandContext;
    const result = sdk ? await fmt(context, { arguments: args.map(arg => encoder.encode(arg)) })
      : await fmtCommand().execute(context);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(reads, ['/first', '/second']);
    assert.deepEqual(run.stdout, [...encoder.encode('\tone two\nstdin words\n        three four\n')]);
    assert.deepEqual(run.stderr, []);
    await run.cleanups[0]!();
  }
});

test('typed SDK options match grouped CLI options and own a literal byte prefix', async () => {
  const cli = fixture(['-cu', '-w8', '-p> '], '> aa bb cc dd ee');
  const sdk = fixture(['--unknown'], '> aa bb cc dd ee');
  const prefix = encoder.encode('> ');
  const pending = fmt(sdk.context, { width: 8, crown: true, uniform: true, prefix });
  prefix.fill(120);
  assert.equal((await pending).exitCode, 0);
  assert.equal((await fmtCommand().execute(cli.context)).exitCode, 0);
  assert.deepEqual(sdk.stdout, cli.stdout);
  assert.deepEqual(sdk.stderr, cli.stderr);
});
test('typed SDK operands are literal VFS paths, including flag-looking names', async () => {
  const run = fixture([], '');
  const reads: string[] = [];
  const context = { ...run.context, fs: { capabilities: { read: true },
    async readFile(path: string, options: { signal: AbortSignal }) {
      assert.ok(run.cleanups.length); assert.equal(options.signal.aborted, false);
      reads.push(path); return encoder.encode('aa bb cc dd ee');
    },
  } } as unknown as CommandContext;
  assert.equal((await fmt(context, { width: 8, files: ['--unknown'] })).exitCode, 0);
  assert.deepEqual(reads, ['/--unknown']);
  assert.deepEqual(run.stdout, [...encoder.encode('aa bb cc\ndd ee\n')]);
});
test('typed SDK invalid goals use native parser errors; mixing argv and typed options fails', async () => {
  for (const options of [{ width: 10, goal: 20 }, { arguments: [], width: 8 }]) {
    const run = fixture([], 'unused');
    let acquired = false;
    const context = { ...run.context, stdin: { [Symbol.asyncIterator]() { acquired = true; throw new Error(); } } };
    assert.equal((await fmt(context, options)).exitCode, 1);
    assert.equal(acquired, false);
    assert.deepEqual(run.stdout, []);
    assert.deepEqual(run.stderr, [...encoder.encode('width' in options && 'goal' in options
      ? "fmt: invalid width: '20': Value too large for defined data type\n"
      : 'fmt: SDK arguments cannot be combined with formatting options\n')]);
  }
});

test('typed SDK byte admission rejects oversized prefix and operands before I/O', async () => {
  for (const options of [{ prefix: new Uint8Array(20) }, { files: ['x'.repeat(20)] }, { width: Number.NaN }]) {
    const run = fixture([], 'unused');
    let acquired = false;
    const context = { ...run.context, stdin: { [Symbol.asyncIterator]() { acquired = true; throw new Error(); } } };
    assert.equal((await fmt(context, { ...options, limits: { argumentBytes: 10 } })).exitCode, 1);
    assert.equal(acquired, false);
    assert.deepEqual(run.stdout, []);
  }
});

test('typed SDK shares zero widths, goal-only defaults and mode precedence with CLI', async () => {
  for (const [options, args] of [
    [{ width: 0 }, ['-w0']], [{ goal: 0 }, ['-g0']], [{ goal: 20 }, ['-g20']],
    [{ split: true, crown: true, tagged: true, uniform: true }, ['-sctu']],
    [{ crown: true, tagged: true }, ['-ct']],
  ] as const) {
    const input = '  aa bb cc dd ee\n    ff gg hh\n';
    const cli = fixture([...args], input), sdk = fixture([], input);
    assert.equal((await fmt(sdk.context, options)).exitCode, 0);
    assert.equal((await fmtCommand().execute(cli.context)).exitCode, 0);
    assert.deepEqual(sdk.stdout, cli.stdout);
    assert.deepEqual(sdk.stderr, cli.stderr);
  }
});
