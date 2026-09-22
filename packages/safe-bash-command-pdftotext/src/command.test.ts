import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { createPdftotextCommand, pdftotext } from './command.js';

function fixture(args: readonly string[]) {
  const carrier = createCommandArguments(args);
  const out: number[] = [], err: number[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const controller = new AbortController();
  const context = { args: carrier.args, argumentValues: carrier, signal: controller.signal,
    stdout: { async write(bytes: Uint8Array) { controller.signal.throwIfAborted(); assert.ok(cleanups.length); await Promise.resolve(); out.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { controller.signal.throwIfAborted(); assert.ok(cleanups.length); await Promise.resolve(); err.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: new Proxy({}, { get() { throw new Error('No extraction capability'); } }),
    stdin: { [Symbol.asyncIterator]() { throw new Error('No extraction capability'); } },
  } as unknown as CommandContext;
  return { context, out, err, controller, cleanups };
}
test('informational CLI and SDK operations agree and await byte writes', async () => {
  for (const [arg, action] of [['-h', 'help'], ['-v', 'version'], ['-listenc', 'listEnc']] as const) {
    const cli = fixture([arg]), sdk = fixture([]);
    assert.equal((await createPdftotextCommand().execute(cli.context)).exitCode, 0);
    assert.equal((await pdftotext(sdk.context, { flags: { [action]: true } })).exitCode, 0);
    assert.deepEqual(cli.out, sdk.out); assert.ok(cli.out.length);
    await Promise.all(cli.cleanups.map(close => close()));
  }
});
test('literal SDK paths and CLI -- agree; extraction remains explicitly unqualified', async () => {
  const cli = fixture(['--', '-document.pdf', '-']), sdk = fixture([]);
  assert.equal((await createPdftotextCommand().execute(cli.context)).exitCode, 99);
  const result = await pdftotext(sdk.context, { input: '-document.pdf', output: '-' });
  assert.equal(result.exitCode, 99); assert.equal(result.extractionQualified, false);
  assert.deepEqual(cli.err, sdk.err); assert.equal(cli.out.length, 0);
});
test('unknown flags and attached options fail explicitly; early errors precede help', async () => {
  for (const args of [['-wat', '-h'], ['-r72', '-h'], ['-colspacing', '0', '-h'], ['-urls', '-bbox', '-h']]) {
    const f = fixture(args);
    assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 99);
    assert.equal(f.out.length, 0); assert.ok(f.err.length);
  }
});
test('unknown-option admission precedes quiet installation and accepts password operands literally', async () => {
  const f = fixture(['-q', 'input.pdf', '-qr', '-h']);
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 99);
  assert.equal(f.out.length, 0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.err)), 'pdftotext: Unknown option: -qr\n');
  const cli = fixture(['-upw', '-unknown', '-h']), sdk = fixture([]);
  assert.equal((await createPdftotextCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await pdftotext(sdk.context, { userPassword: '-unknown', flags: { help: true } })).exitCode, 0);
  assert.deepEqual(sdk.out, cli.out);
  assert.deepEqual(sdk.err, cli.err);
});
test('stdin needs an output; invalid EOL bypasses quiet; invalid hyphens respect quiet', async () => {
  for (const args of [['-'], ['-q', '-remove-hyphens', 'bad', 'a.pdf', '-']]) {
    const f = fixture(args); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 99);
    if (args[0] === '-q') assert.equal(f.err.length, 0);
  }
  const f = fixture(['-q', '-eol', 'bad', '-h']);
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.err)), "Bad '-eol' value on command line\n");
});
test('cancellation and output limits propagate without acquiring input', async () => {
  const f = fixture(['-h']); f.controller.abort(new Error('cancelled'));
  await assert.rejects(async () => createPdftotextCommand().execute(f.context), /cancelled/);
  await assert.rejects(async () => createPdftotextCommand({ maxOutputBytes: 0 }).execute(fixture(['-h']).context), /outputBytes/);
});
test('SDK output alone cannot become the input operand', async () => {
  const f = fixture([]);
  assert.equal((await pdftotext(f.context, { output: 'output.txt' })).exitCode, 99);
  assert.match(new TextDecoder().decode(Uint8Array.from(f.err)), /Expected PDF-file/);
});
test('cleanup cancels and drains an acquired owned write', async () => {
  const f = fixture(['-h']);
  let started!: () => void, release!: () => void;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const context = { ...f.context, stdout: { async write() { throw new Error('Use owned output'); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { started(); await pending; } } } };
  const task = Promise.resolve(createPdftotextCommand().execute(context));
  void task.catch(() => {});
  await acquired;
  let drained = false;
  const cleanup = Promise.resolve(f.cleanups[0]!()).then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  release(); await cleanup;
  await assert.rejects(async () => task, /closed/);
});
test('SDK snapshots nested options before asynchronous work', async () => {
  const f = fixture([]);
  const options = { flags: { help: true }, maxOutputBytes: 65536 };
  const pending = pdftotext(f.context, options);
  options.flags.help = false; options.maxOutputBytes = 0;
  assert.equal((await pending).exitCode, 0); assert.ok(f.out.length);
});
test('SDK finite numbers use the same decimal admission as CLI operands', async () => {
  for (const [value, decimal] of [[1e-7, '0.0000001'], [1e21, '1000000000000000000000']] as const) {
    const cli = fixture(['-r', decimal, '-h']), sdk = fixture([]);
    assert.equal((await createPdftotextCommand().execute(cli.context)).exitCode, 0);
    assert.equal((await pdftotext(sdk.context, { numbers: { resolution: value }, flags: { help: true } })).exitCode, 0);
    assert.deepEqual(sdk.out, cli.out);
    assert.deepEqual(sdk.err, cli.err);
  }
});

test('quota failure preserves a completed diagnostic but publishes no oversized help write', async () => {
  const diagnostic = "Bad '-eol' value on command line\n";
  const f = fixture(['-eol', 'bad', '-h']);
  await assert.rejects(async () => createPdftotextCommand({ maxOutputBytes: diagnostic.length }).execute(f.context), /outputBytes/);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.err)), diagnostic);
  assert.deepEqual(f.out, []);
  await Promise.all(f.cleanups.map(close => close()));
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});

test('sink rejection retains its identity, removes listeners and permits idempotent cleanup', async () => {
  const f = fixture(['-h']), failure = new Error('denied output');
  const context = { ...f.context, stdout: { async write() { throw failure; } } };
  await assert.rejects(async () => createPdftotextCommand().execute(context), error => error === failure);
  await Promise.all(f.cleanups.map(close => close()));
  await Promise.all(f.cleanups.map(close => close()));
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});

test('caller cancellation during owned output drains pending work and removes both subscriptions', async () => {
  const f = fixture(['-h']), consumer = new AbortController();
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const failure = new Error('cancel during output');
  const context = { ...f.context, stdout: { async write() { assert.fail('Unowned write'); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { start(); await pending; } } } };
  const task = Promise.resolve(createPdftotextCommand().execute(context));
  const rejected = assert.rejects(async () => task, error => error === failure);
  await started;
  f.controller.abort(failure);
  let settled = false;
  void task.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  finish(); await rejected;
  await Promise.all(f.cleanups.map(close => close()));
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(consumer.signal, 'abort').length, 0);
});

test('unavailable extraction never requests even the first chunk of an infinite hostile source', async () => {
  const f = fixture(['-', '-']);
  let reads = 0;
  const context = { ...f.context, stdin: { async *[Symbol.asyncIterator]() {
    while (true) { reads++; yield new Uint8Array([0xff, 0, 0x25]); }
  } } };
  assert.equal((await createPdftotextCommand().execute(context)).exitCode, 99);
  assert.equal(reads, 0);
  assert.deepEqual(f.out, []);
});
