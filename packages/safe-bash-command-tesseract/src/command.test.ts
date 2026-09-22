import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, commandRuntimeIdentity, type CommandContext } from 'safe-bash-contracts/command';
import { createTesseractCommand, tesseract, tesseractCommands } from './command.js';
import { parseTesseractArguments } from './arguments.js';

function fixture(args: readonly string[]) {
  const carrier = createCommandArguments(args);
  const stdout: number[] = [], stderr: number[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const controller = new AbortController();
  const context = {
    args: carrier.args, argumentValues: carrier, signal: controller.signal,
    stdout: { async write(bytes: Uint8Array) { assert.ok(cleanups.length); await Promise.resolve(); stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { assert.ok(cleanups.length); await Promise.resolve(); stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: new Proxy({}, { get() { throw new Error('Unavailable recognition must not touch VFS'); } }),
    stdin: { [Symbol.asyncIterator]() { throw new Error('Unavailable recognition must not consume input'); } },
  } as unknown as CommandContext;
  return { context, controller, stdout, stderr, cleanups };
}
test('command help/version await byte output and preserve canonical identity', async () => {
  for (const args of [[], ['--help'], ['--version']]) {
    const f = fixture(args);
    const command = createTesseractCommand();
    assert.equal(command.runtimeIdentity, commandRuntimeIdentity);
    assert.equal((await command.execute(f.context)).exitCode, 0);
    assert.ok(f.stdout.length); assert.equal(f.stderr.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
test('CLI and SDK fail closed with equivalent options and deterministic diagnostics', async () => {
  const cli = fixture(['--psm', 'single_line', '-l', 'eng', '--', '-image', '-']);
  const sdk = fixture([]);
  const result = await tesseract(sdk.context, { input: '-image', outputbase: '-', psm: 7, language: 'eng' });
  assert.equal(result.exitCode, 1); assert.equal(result.recognitionQualified, false);
  assert.equal((await createTesseractCommand().execute(cli.context)).exitCode, 1);
  assert.deepEqual(cli.stderr, sdk.stderr); assert.equal(cli.stdout.length, 0);
  assert.match(new TextDecoder().decode(Uint8Array.from(cli.stderr)), /qualified recognition engine is unavailable/);
});
test('invalid options fail without input acquisition; list-langs retains native status zero', async () => {
  const invalid = fixture(['--unknown']);
  assert.equal((await createTesseractCommand().execute(invalid.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(Uint8Array.from(invalid.stderr)), 'tesseract: unknown option: --unknown\n');
  const list = fixture(['--list-langs']);
  assert.equal((await createTesseractCommand().execute(list.context)).exitCode, 0);
  assert.equal(list.stdout.length, 0); assert.ok(list.stderr.length);
});
test('cancellation and output budget exhaustion are explicit', async () => {
  const cancelled = fixture(['--help']); cancelled.controller.abort(new Error('cancelled'));
  await assert.rejects(async () => createTesseractCommand().execute(cancelled.context), /cancelled/);
  assert.equal(cancelled.stdout.length, 0);
  await assert.rejects(async () => createTesseractCommand({ maxOutputBytes: 0 }).execute(fixture(['--help']).context), /outputBytes/);
});
test('plugin registration is opt-in and carries replacement policy', () => {
  let registered = false;
  tesseractCommands({ replace: true }).setup({ commands: { register(command: { name: string }, options: { replace?: boolean }) {
    assert.equal(command.name, 'tesseract'); assert.equal(options.replace, true); registered = true;
  } } } as never);
  assert.equal(registered, true);
});
test('invocation cleanup cancels output and drains an acquired owned write', async () => {
  const f = fixture(['--help']);
  let release!: () => void, started!: () => void;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const context = { ...f.context, stdout: {
    ...f.context.stdout,
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { started(); await pending; } },
  } };
  const execution = Promise.resolve(createTesseractCommand().execute(context));
  const rejected = assert.rejects(execution, /invocation closed/);
  await acquired;
  let drained = false;
  const cleanup = Promise.resolve(f.cleanups[0]!()).then(() => { drained = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(drained, false);
  release();
  await rejected; await cleanup;
  assert.equal(drained, true);
});
test('end of options permits literal VFS operands without altering native outputbase consumption', () => {
  assert.equal(parseTesseractArguments(['--', '-literal', 'out.txt']).input, '-literal');
  assert.equal(parseTesseractArguments(['image', '--psm', 'txt']).outputbase, '--psm');
  assert.throws(() => parseTesseractArguments(['-leng', 'image', 'out']), /unknown option/);
});

test('SDK option-only invocations require operands just like the CLI', async () => {
  for (const [args, options] of [
    [['--psm', '7'], { psm: 7 }],
    [['-l', 'eng'], { language: 'eng' }],
    [['--dpi', '300'], { dpi: 300 }],
  ] as const) {
    const cli = fixture(args), sdk = fixture([]);
    const cliResult = await createTesseractCommand().execute(cli.context);
    const sdkResult = await tesseract(sdk.context, options);
    assert.equal(cliResult.exitCode, 1);
    assert.deepEqual(sdkResult, cliResult);
    assert.deepEqual(sdk.stderr, cli.stderr);
    assert.deepEqual(sdk.stdout, cli.stdout);
  }
  const empty = fixture([]);
  assert.equal((await tesseract(empty.context, {})).exitCode, 0);
  assert.ok(empty.stdout.length);
});
