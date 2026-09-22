import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { createSofficeCommand, soffice } from './command.js';
function fixture(args: string[]) {
  const carrier = createCommandArguments(args), stdout: number[] = [], stderr: number[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const context = { command: 'soffice', args: carrier.args, argumentValues: carrier,
    signal: new AbortController().signal, registerCleanup(callback: () => void | Promise<void>) { cleanups.push(callback); },
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } }
  } as unknown as CommandContext;
  for (const name of ['fs', 'stdin', 'env', 'invoke']) Object.defineProperty(context, name, { configurable: true, get() { throw new Error('unadmitted I/O: ' + name); } });
  return { context, stdout, stderr, cleanups };
}
test('CLI and typed SDK conversion fail identically before capability access', async () => {
  const cli = fixture(['--convert-to', 'pdf', '--outdir', '/out', '--', '-input.docx']), sdk = fixture([]);
  const a = await createSofficeCommand().execute(cli.context);
  const b = await soffice(sdk.context, { conversion: { extension: 'pdf', filter: '', options: '' }, outdir: '/out', files: ['-input.docx'] });
  assert.equal(a.exitCode, 1); assert.deepEqual(a, b);
  assert.deepEqual(cli.stderr, sdk.stderr); assert.deepEqual(cli.stdout, []);
  assert.equal(new TextDecoder().decode(Uint8Array.from(cli.stderr)), 'soffice: unsupported: Office conversion is not qualified\n');
  await Promise.all(cli.cleanups.map(close => close()));
});
test('help is an actual command with SDK parity and cleanup before output acquisition', async () => {
  const cli = fixture(['-h']), sdk = fixture([]);
  const destination = cli.context.stdout;
  Object.defineProperty(cli.context, 'stdout', { get() { assert.ok(cli.cleanups.length); return destination; } });
  assert.equal((await createSofficeCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await soffice(sdk.context, { help: true })).exitCode, 0);
  assert.deepEqual(cli.stdout, sdk.stdout); assert.deepEqual(cli.stderr, []);
});
test('unknown flags fail explicitly and deprecated flags warn', async () => {
  const unknown = fixture(['--unknown']);
  assert.equal((await createSofficeCommand().execute(unknown.context)).exitCode, 1);
  assert.match(new TextDecoder().decode(Uint8Array.from(unknown.stderr)), /unknown option: --unknown/);
  const old = fixture(['-help']);
  assert.equal((await createSofficeCommand().execute(old.context)).exitCode, 0);
  assert.match(new TextDecoder().decode(Uint8Array.from(old.stderr)), /deprecated single-dash option: -help/);
  const ordered = fixture([]);
  assert.equal((await soffice(ordered.context, { args: ['-help'] })).exitCode, 0);
  assert.deepEqual(ordered.stdout, old.stdout); assert.deepEqual(ordered.stderr, old.stderr);
});
test('output backpressure is awaited and cancellation propagates', async () => {
  const f = fixture(['--help']);
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  Object.assign(f.context, { stdout: { async write() { start(); await pending; } } });
  const running = Promise.resolve(createSofficeCommand().execute(f.context)).then(result => { settled = true; return result; });
  await started; assert.equal(settled, false); release(); await running;
  const aborted = fixture(['--help']), controller = new AbortController(), reason = new Error('cancel');
  controller.abort(reason); Object.assign(aborted.context, { signal: controller.signal });
  await assert.rejects(Promise.resolve(createSofficeCommand().execute(aborted.context)), error => error === reason);
});
test('external cleanup cancels output and remains idempotent', async () => {
  const f = fixture(['--help']);
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  Object.assign(f.context, { stdout: { async write() { start(); await pending; } } });
  const running = Promise.resolve(createSofficeCommand().execute(f.context));
  const rejected = assert.rejects(running);
  await started;
  const closing = f.cleanups[0]!();
  finish(); await closing; await rejected;
  await f.cleanups[0]!();
});
test('bounded admission fails without unaccounted diagnostic bytes', async () => {
  for (const limits of [{ argumentBytes: 1 }, { retainedBytes: 1 }, { work: 1 }, { outputBytes: 1 }]) {
    const f = fixture(['--help']);
    assert.deepEqual(await createSofficeCommand({ limits }).execute(f.context), { exitCode: 1, status: 'limit' });
    assert.deepEqual(f.stdout, []); assert.deepEqual(f.stderr, []);
  }
});
test('help and version fit an 80-column terminal', async () => {
  for (const option of ['--help', '--version']) {
    const f = fixture([option]);
    assert.equal((await createSofficeCommand().execute(f.context)).exitCode, 0);
    for (const line of new TextDecoder().decode(Uint8Array.from(f.stdout)).split('\n')) assert.ok(line.length <= 80, line);
  }
});
test('diagnostic exhaustion returns the same typed limit as normal output exhaustion', async () => {
  const f = fixture(['--unknown']);
  assert.deepEqual(await createSofficeCommand({ limits: { outputBytes: 1 } }).execute(f.context), { exitCode: 1, status: 'limit' });
  assert.deepEqual(f.stderr, []);
});
test('invalid resource limits return typed failure before output capability acquisition', async () => {
  for (const value of [-1, NaN, Infinity, 1.5]) {
    for (const sdk of [false, true]) {
      const f = fixture(['--help']);
      for (const name of ['stdout', 'stderr']) Object.defineProperty(f.context, name, {
        get() { throw new Error('output acquired before valid budget'); }
      });
      const options = { limits: { work: value } };
      const result = sdk ? await soffice(f.context, { ...options, help: true })
        : await createSofficeCommand(options).execute(f.context);
      assert.deepEqual(result, { exitCode: 1, status: 'limit' });
      assert.equal(f.cleanups.length, 1);
      await f.cleanups[0]!();
    }
  }
});

test('failed sink writes preserve their reason and cleanup remains reusable', async () => {
  for (const reason of [new Error('sink denied'), 0, undefined]) {
    const f = fixture(['--help']);
    Object.assign(f.context, { stdout: { async write() { throw reason; } } });
    let caught = false;
    try { await createSofficeCommand().execute(f.context); }
    catch (error) { caught = true; assert.equal(error, reason); }
    assert.equal(caught, true);
    assert.deepEqual(f.stderr, []);
    await Promise.all([f.cleanups[0]!(), f.cleanups[0]!()]);
  }
});

test('warning output can precede quota failure and is not atomic', async () => {
  const warning = 'soffice: warning: deprecated single-dash option: -help\n';
  const f = fixture(['-help']);
  assert.deepEqual(await createSofficeCommand({ limits: { outputBytes: warning.length } }).execute(f.context),
    { exitCode: 1, status: 'limit' });
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)), warning);
  assert.deepEqual(f.stdout, []);
  const fresh = fixture(['--help']);
  assert.equal((await createSofficeCommand().execute(fresh.context)).exitCode, 0);
});

test('cancellation during an admitted write preserves caller reason and awaits the sink', async () => {
  const f = fixture(['--help']), controller = new AbortController(), reason = new Error('output cancelled');
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  Object.assign(f.context, { signal: controller.signal, stdout: { async write() { start(); await pending; } } });
  const running = Promise.resolve(createSofficeCommand().execute(f.context)).finally(() => { settled = true; });
  const rejected = assert.rejects(running, error => error === reason);
  await started; controller.abort(reason);
  await Promise.resolve(); assert.equal(settled, false);
  release(); await rejected;
  await f.cleanups[0]!();
});

test('hostile Office operands and inspection modes never acquire input or host authority', async () => {
  for (const args of [
    ['--cat', '-'], ['--script-cat', '/macro.docm'],
    ['--convert-to', 'pdf', 'https://example.invalid/private.docx'],
    ['--infilter=Text:remote:options', '--convert-to', 'pdf', '/etc/passwd'],
    ['--help', '--accept=socket,host=localhost'], ['--help', '-env:UserInstallation=/profile']
  ]) {
    const f = fixture(args);
    assert.equal((await createSofficeCommand().execute(f.context)).exitCode, 1);
    assert.deepEqual(f.stdout, []);
    await f.cleanups[0]!();
  }
});

test('chunked Office input is untouched when no conversion engine is admitted', async () => {
  const f = fixture(['--cat', '-']);
  let pulled = 0, returned = 0;
  const input = {
    [Symbol.asyncIterator]() { return this; },
    async next() { pulled++; return { done: false as const, value: Uint8Array.of(80, 75) }; },
    async return() { returned++; return { done: true as const, value: undefined }; }
  };
  Object.defineProperty(f.context, 'stdin', { value: input });
  assert.equal((await createSofficeCommand().execute(f.context)).exitCode, 1);
  assert.equal(pulled, 0); assert.equal(returned, 0);
});
