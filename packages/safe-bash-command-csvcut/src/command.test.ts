import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandArguments, commandRuntimeIdentity, type CommandContext } from 'safe-bash-contracts/command';
import { csvcut, csvcutCommand, parseCsvcutArguments } from './command.js';
import { shellValueFromBytes } from 'safe-bash-contracts/value';
import { CsvBudget } from 'safe-bash-csv-engine';
const encoder = new TextEncoder(), decoder = new TextDecoder();
function fixture(args: string[], input: string, chunks = 1) {
  const carrier = createCommandArguments(args), output: number[] = [], errors: number[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  let retired = 0, acquired = 0;
  const context = {
    command: 'csvcut', args: carrier.args, argumentValues: carrier, cwd: '/data', env: {},
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length); acquired++;
      const bytes = encoder.encode(input); let offset = 0;
      return { async next() { if (offset === bytes.length) return { done: true, value: undefined };
        const value = bytes.slice(offset, offset + chunks); offset += value.length; return { done: false, value }; },
      async return() { retired++; return { done: true, value: undefined }; } };
    } },
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); output.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(...bytes); } },
    registerCleanup(fn: () => Promise<void>) { cleanups.push(fn); }, fs: {},
  } as unknown as CommandContext;
  return { context, cleanups, output: () => decoder.decode(new Uint8Array(output)), errors: () => decoder.decode(new Uint8Array(errors)), retired: () => retired, acquired: () => acquired };
}
test('blocked output cancellation preserves its reason, emits only the admitted header and drains cleanup', async () => {
  for (const reason of [false, 0, '', null]) {
    const run = fixture([], 'a\nx\n'), controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let writes = 0;
    const context = { ...run.context, signal: controller.signal, stdout: {
      async write(bytes: Uint8Array) {
        writes++; assert.equal(decoder.decode(bytes), 'a\n'); started();
        await new Promise<void>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      }
    } };
    const pending = csvcut(context); const rejected = assert.rejects(pending, error => error === reason);
    await ready; controller.abort(reason); await rejected;
    await Promise.all(run.cleanups.map(cleanup => cleanup()));
    assert.equal(writes, 1); assert.equal(run.retired(), 1); assert.equal(run.errors(), '');
  }
});

test('transport failure remains a failure after admission and a fresh invocation recovers', async () => {
  const run = fixture([], 'a\nx\n'), failure = new Error('destination denied');
  let writes = 0;
  const context = { ...run.context, stdout: { async write(bytes: Uint8Array) {
    if (++writes === 1) await run.context.stdout.write(bytes);
    else throw failure;
  } } };
  await assert.rejects(csvcut(context), error => error === failure);
  await Promise.all(run.cleanups.map(cleanup => cleanup()));
  assert.equal(run.output(), 'a\n'); assert.equal(run.errors(), ''); assert.equal(run.retired(), 1);
  const next = fixture([], 'a\nx\n'); assert.equal((await csvcut(next.context)).exitCode, 0);
  assert.equal(next.output(), 'a\nx\n');
});

test('each command ledger rejects exhausted quotas without masking status or retaining the input', async () => {
  for (const limits of [{ inputBytes: 0 }, { decodedBytes: 0 }, { retainedBytes: 0 }, { fieldBytes: 0 }, { cells: 0 }, { scannedCells: 0 }, { work: 0 }, { outputBytes: 0 }, { argumentBytes: 0 }]) {
    const run = fixture(['-c1'], 'a\nx\n');
    assert.equal((await csvcut(run.context, undefined, { limits })).exitCode, 1);
    assert.equal(run.output(), '');
    await Promise.all(run.cleanups.map(cleanup => cleanup()));
    assert.equal(run.retired(), run.acquired());
  }
});
test('independent projection controls preserve CLI/SDK parity across byte chunks', async () => {
  const controls = [
    { args: ['-xc3,1,3'], options: { deleteEmptyRows: true, include: '3,1,3' }, input: 'id,value,note\na,1,\nb,2,\nc,3,0\nshort\n', expected: 'note,id,note\n,a,\n,b,\n0,c,0\n,short,\n' },
    { args: ['-t', '-d;', '-c2'], options: { include: '2', dialect: { tabs: true, delimiter: ';' } }, input: 'a\tb\nx\ty\n', expected: 'b\ny\n' },
    { args: ['-C1-2'], options: { exclude: '1-2' }, input: 'a,b\nx,y\n', expected: '\n\n' },
    { args: ['-n', '--zero'], options: { names: true, zero: true }, input: 'a,b\nx,y\n', expected: '  0: a\n  1: b\n' },
    { args: [], options: {}, input: '', expected: '\n' },
    { args: ['-c1'], options: { include: '1' }, input: '', expected: '\n' },
    { args: ['-c', 'missing'], options: { include: 'missing' }, input: '', expected: '\n' },
    { args: ['--linenumbers', '-c1'], options: { lineNumbers: true, include: '1' }, input: '', expected: 'line_number\n' },
    { args: ['-c1'], options: { include: '1' }, input: '\nAda,1\n', expected: '\n\n' },
  ];
  assert.equal(csvcutCommand.runtimeIdentity, commandRuntimeIdentity);
  for (const control of controls) for (const chunks of [1, 4096]) {
    const cli = fixture(control.args, control.input, chunks), sdk = fixture([], control.input, chunks);
    assert.equal((await csvcutCommand.execute(cli.context)).exitCode, 0);
    assert.equal((await csvcut(sdk.context, control.options)).exitCode, 0);
    assert.equal(cli.output(), control.expected); assert.equal(sdk.output(), control.expected);
    assert.equal(cli.errors(), ''); assert.equal(cli.retired(), 1);
    await Promise.all(cli.cleanups.map(fn => fn())); assert.equal(cli.retired(), 1);
  }
});
test('grammar rejects unknown and later-source flags before input acquisition', async () => {
  for (const args of [['--ignore-unknown-columns'], ['--unknown'], ['-c'], ['--names=yes'], ['one', 'two']]) {
    const run = fixture(args, 'a\n');
    assert.equal((await csvcutCommand.execute(run.context)).exitCode, 2);
    assert.equal(run.acquired(), 0); assert.equal(run.output(), ''); assert.match(run.errors(), /^csvcut: /);
  }
});
test('grouped booleans, attached values, equals and literal operands', () => {
  const budget = new CsvBudget({}, new AbortController().signal);
  assert.deepEqual(parseCsvcutArguments(['-xHc2', '--not-columns=missing', '--', '-literal'], budget), {
    deleteEmptyRows: true, headerless: true, include: '2', exclude: 'missing', filePath: '-literal', dialect: {}
  });
});
test('runtime CSV failures use status one with deterministic stderr', async () => {
  for (const args of [['-n'], ['-nH'], ['-cunknown']]) {
    const run = fixture(args, args.includes('-n') ? '' : 'a\nx\n');
    assert.equal((await csvcutCommand.execute(run.context)).exitCode, 1);
    assert.equal(run.output(), ''); assert.match(run.errors(), /^csvcut: /);
  }
});
test('literal VFS stream receives invocation cancellation; SDK uses the same capability', async () => {
  for (const sdk of [false, true]) {
    const run = fixture(sdk ? [] : ['--', '-literal'], '');
    const context = { ...run.context, fs: { readStream(path: string, options: { signal: AbortSignal }) {
      assert.equal(path, '/data/-literal'); assert.ok(run.cleanups.length); options.signal.throwIfAborted();
      return (async function* () { yield encoder.encode('a,b\nx,y\n'); })();
    } } } as unknown as CommandContext;
    assert.equal((await (sdk ? csvcut(context, { filePath: '-literal' }) : csvcutCommand.execute(context))).exitCode, 0);
    assert.equal(run.output(), 'a,b\nx,y\n');
  }
});
test('cancellation preserves falsey reasons and cleanup retires a pending cooperative source', async () => {
  const run = fixture([], ''), controller = new AbortController();
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  let returned = 0;
  const context = { ...run.context, signal: controller.signal, fs: { readStream(_path: string, { signal }: { signal: AbortSignal }) {
    return { [Symbol.asyncIterator]() { return { next() { started(); return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }, async return() { returned++; return { done: true, value: undefined }; } }; } };
  } } } as unknown as CommandContext;
  const pending = csvcut(context, { filePath: 'file' }); await ready; controller.abort(0);
  await assert.rejects(pending, reason => reason === 0); assert.equal(returned, 1);
  await Promise.all(run.cleanups.map(fn => fn()));
});
test('byte argv rejects invalid UTF-8 before acquiring input', async () => {
  const run = fixture([], 'a\nx\n');
  const carrier = createCommandArguments([shellValueFromBytes(new Uint8Array([255]))]);
  assert.equal((await csvcut({ ...run.context, args: carrier.args, argumentValues: carrier })).exitCode, 2);
  assert.equal(run.acquired(), 0);
  assert.equal(run.errors(), 'csvcut: Arguments must be valid UTF-8\n');
});
test('SDK snapshots options before asynchronous resource acquisition', async () => {
  const run = fixture([], 'a;b\nx;y\n');
  const options = { include: '2', dialect: { delimiter: ';' } };
  const pending = csvcut(run.context, options); options.include = '1'; options.dialect.delimiter = ',';
  assert.equal((await pending).exitCode, 0); assert.equal(run.output(), 'b\ny\n');
});
test('output limits admit no partial ordinary CSV and fallback VFS reads are bounded', async () => {
  const run = fixture([], 'a\nx\n');
  assert.equal((await csvcut(run.context, {}, { limits: { outputBytes: 3 } })).exitCode, 1);
  assert.equal(run.output(), '');
  const fallback = fixture([], '');
  const context = { ...fallback.context, fs: { async readFile(path: string, options: { signal: AbortSignal; maxBytes: number }) {
    assert.equal(path, '/data/file'); assert.equal(options.maxBytes, 2); options.signal.throwIfAborted();
    return encoder.encode('a\n');
  } } } as unknown as CommandContext;
  assert.equal((await csvcut(context, { filePath: 'file' }, { limits: { inputBytes: 2 } })).exitCode, 0);
  assert.equal(fallback.output(), 'a\n');
});
test('producer bytes may be reused and overridden byte properties are never read', async () => {
  const run = fixture([], ''); const bytes = encoder.encode('a,b\n');
  for (const key of ['length', 'byteLength', 'subarray', 'buffer', 'byteOffset']) Object.defineProperty(bytes, key, { get() { throw new Error(key); } });
  let index = 0;
  const context = { ...run.context, stdin: { [Symbol.asyncIterator]() { return {
    async next() { if (index++ === 0) return { done: false, value: bytes }; if (index === 2) { bytes.set(encoder.encode('x,y\n')); return { done: false, value: bytes }; } return { done: true, value: undefined }; },
    async return() { return { done: true, value: undefined }; }
  }; } } } as unknown as CommandContext;
  assert.equal((await csvcut(context, { include: '2' })).exitCode, 0); assert.equal(run.output(), 'b\ny\n');
});
test('input iterator next is captured once and invoked with its original receiver', async () => {
  const run = fixture([], ''); let index = 0;
  const producer: AsyncIterator<Uint8Array> = {
    async next() { assert.equal(this, producer); if (index++ === 0) {
      producer.next = async () => { throw new Error('replacement next used'); };
      return { done: false, value: encoder.encode('a\nx\n') };
    } return { done: true, value: undefined }; },
    async return() { assert.equal(this, producer); return { done: true, value: undefined }; }
  };
  const context = { ...run.context, stdin: { [Symbol.asyncIterator]: () => producer } };
  assert.equal((await csvcut(context)).exitCode, 0); assert.equal(run.output(), 'a\nx\n');
});
test('registered invocation cleanup cancels cooperative reads and shares its completion', async () => {
  const run = fixture([], ''); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }); let retired = 0;
  const context = { ...run.context, fs: { readStream(_path: string, { signal }: { signal: AbortSignal }) {
    return { [Symbol.asyncIterator]() { return {
      next() { started(); return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
      async return() { retired++; return { done: true, value: undefined }; }
    }; } };
  } } } as unknown as CommandContext;
  const pending = csvcut(context, { filePath: 'file' }); const rejected = assert.rejects(pending, { code: 'INPUT', message: 'csvcut invocation closed' });
  await ready; const closing = run.cleanups[0]!(); assert.equal(run.cleanups[0]!(), closing);
  await closing; await rejected; assert.equal(retired, 1); assert.equal(run.output(), '');
});
test('standalone argument grammar accounts retained token and option allocations', () => {
  const budget = new CsvBudget({ retainedBytes: 0 }, new AbortController().signal);
  assert.throws(() => parseCsvcutArguments(['--columns=2,1'], budget), { code: 'LIMIT' });
});
test('standalone grammar bounds separate option values just like attached values', () => {
  for (const flag of ['-c', '--columns', '-e', '--encoding', '-d', '--delimiter']) {
    for (const limits of [{ retainedBytes: 500 }, { work: 20 }]) {
      const value = 'x'.repeat(1024);
      for (const args of [[flag, value], [flag.startsWith('--') ? `${flag}=${value}` : `${flag}${value}`]]) {
        const budget = new CsvBudget(limits, new AbortController().signal);
        assert.throws(() => parseCsvcutArguments(args, budget), { code: 'LIMIT' });
      }
    }
  }
});
test('SDK codec options match CLI qualification before input acquisition', async () => {
  for (const encoding of ['utf-8-sig', 'utf8-sig', 'latin1']) {
    const cli = fixture(['-e', encoding], 'a\nx\n'), sdk = fixture([], 'a\nx\n');
    const a = await csvcut(cli.context), b = await csvcut(sdk.context, { encoding });
    assert.equal(a.exitCode, encoding === 'latin1' ? 1 : 0); assert.equal(b.exitCode, a.exitCode);
    assert.equal(sdk.output(), cli.output()); assert.equal(sdk.errors(), cli.errors());
    if (encoding === 'latin1') assert.equal(sdk.acquired(), 0);
  }
});
test('unqualified native field-size capability still validates its integer grammar', async () => {
  for (const args of [['-zx'], ['--maxfieldsize=no'], ['-z', '1.5']]) {
    const run = fixture(args, 'unused');
    assert.equal((await csvcutCommand.execute(run.context)).exitCode, 2);
    assert.equal(run.acquired(), 0); assert.equal(run.output(), '');
    assert.equal(run.errors(), 'csvcut: Expected an ASCII integer\n');
  }
  const run = fixture(['-z10'], 'unused');
  assert.equal((await csvcutCommand.execute(run.context)).exitCode, 1);
  assert.equal(run.acquired(), 0);
});

test('repeated quoting options qualify the final value and match SDK projection', async () => {
  for (const args of [['-u1', '--quoting=0'], ['--quoting=2', '-u0']]) {
    const cli = fixture(args, 'a,b\n"x,y",z\n', 1);
    const sdk = fixture([], 'a,b\n"x,y",z\n', 1);
    assert.equal((await csvcutCommand.execute(cli.context)).exitCode, 0);
    assert.equal((await csvcut(sdk.context, { dialect: { quoting: 0 } })).exitCode, 0);
    assert.equal(cli.output(), 'a,b\n"x,y",z\n');
    assert.equal(sdk.output(), cli.output());
    assert.equal(cli.errors(), '');
    assert.equal(cli.retired(), 1);
  }
  for (const args of [['-u0', '-u1'], ['-u3', '--quoting=2']]) {
    const run = fixture(args, 'unused');
    assert.equal((await csvcutCommand.execute(run.context)).exitCode, 1);
    assert.equal(run.acquired(), 0);
    assert.equal(run.errors(), 'csvcut: Quoting modes 1 and 2 are not qualified\n');
  }
  for (const args of [['-ux', '-u0'], ['--quoting=1.5', '-u0']]) {
    const run = fixture(args, 'unused');
    assert.equal((await csvcutCommand.execute(run.context)).exitCode, 2);
    assert.equal(run.acquired(), 0);
    assert.equal(run.errors(), 'csvcut: Expected an ASCII integer\n');
  }
});
