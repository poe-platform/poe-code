import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import type { PlaywrightControllerOptions } from '../../src/playwright/controller.js';
import type { PlaywrightInvocation } from '../../src/playwright/invocation.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';
import { createPlaywrightCli } from '../../src/commands/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfilled => { resolve = fulfilled; });
  return { promise, resolve };
}

function fixture(maxCommandBytes: number, abilities?: PlaywrightControllerOptions['abilities']) {
  const controller = createPlaywrightController({ limits: { maxCommandBytes }, ...(abilities ? { abilities } : {}) });
  const output: string[] = [];
  const run = (args: string[], overrides: Partial<PlaywrightInvocation> = {}) => controller.run({
    args, env: {}, signal: new AbortController().signal, async write(text) { output.push(text); }, ...overrides,
  });
  return { controller, output, run };
}

for (const args of [['--version'], ['--help'], ['--json', '--version'], ['list'], ['--json', 'close-all']]) {
  test(`command budget rejects ${args.join(' ')} before its output sink`, async context => {
    const state = fixture(1);
    context.after(() => state.controller.dispose());
    await assert.rejects(state.run(args), PlaywrightResourceLimitError);
    assert.deepEqual(state.output, []);
  });
}

test('builtin output admits an exact boundary independently for every invocation', async context => {
  const state = fixture(7);
  context.after(() => state.controller.dispose());
  await Promise.all([state.run(['--version']), state.run(['--version'])]);
  await state.run(['--version']);
  assert.deepEqual(state.output, ['0.1.20\n', '0.1.20\n', '0.1.20\n']);
});

for (const mode of [[], ['--json'], ['--raw']]) {
  test(`custom output and ${mode[0] ?? 'standard'} response share the command budget`, async context => {
    const state = fixture(64, { list: { scope: 'client', async execute(request) {
      await request.write('a'.repeat(40));
      return { sections: [{ title: 'Result', content: 'b'.repeat(40) }] };
    } } });
    context.after(() => state.controller.dispose());
    await assert.rejects(state.run([...mode, 'list']), PlaywrightResourceLimitError);
    assert.deepEqual(state.output, ['a'.repeat(40)]);
  });
}

test('UTF-8 custom writes, artifact reads/writes and returned result share an exact budget', async context => {
  for (const maxBytes of [20, 21]) {
    const state = fixture(maxBytes, { list: { scope: 'client', async execute(request) {
      await request.write('é');
      await request.readFile('input');
      await request.writeArtifact(new Uint8Array([1, 2]), 'output');
      return { sections: [{ title: 'Result', content: '💥' }] };
    } } });
    context.after(() => state.controller.dispose());
    const artifacts: number[] = [];
    const execution = state.run(['list'], {
      async readArtifact() { return new Uint8Array(1); },
      async writeArtifact(bytes) { artifacts.push(bytes.byteLength); },
    });
    if (maxBytes === 20) {
      await assert.rejects(execution, PlaywrightResourceLimitError);
      assert.deepEqual(state.output, ['é']);
    } else {
      await execution;
      assert.deepEqual(state.output, ['é', '### Result\n💥\n']);
    }
    assert.deepEqual(artifacts, [2]);
  }
});

for (const termination of ['dispose', 'root'] as const) {
  test(`pending version output drains before ${termination} settlement`, async () => {
    const state = fixture(7);
    const started = deferred();
    const sink = deferred();
    const root = new AbortController();
    let cleanup: (() => Promise<void>) | undefined;
    let runFinished = false;
    let disposalFinished = false;
    const invocation = state.run(['--version'], {
      signal: root.signal,
      registerCleanup(registered) { cleanup = registered; },
      async write() { assert.ok(cleanup); started.resolve(); await sink.promise; },
    });
    const outcome = invocation.then(() => undefined, error => error).finally(() => { runFinished = true; });
    await started.promise;
    if (termination === 'root') root.abort(new Error('root cancelled'));
    const disposal = state.controller.dispose().finally(() => { disposalFinished = true; });
    await setImmediate();
    assert.equal(runFinished, false);
    assert.equal(disposalFinished, false);
    sink.resolve();
    await disposal;
    assert.ok(await outcome instanceof Error);
    await cleanup!();
  });
}

test('output sink rejection keeps its identity and receives no second write', async context => {
  const state = fixture(7);
  context.after(() => state.controller.dispose());
  const failure = new Error('sink failed');
  let writes = 0;
  await assert.rejects(state.run(['--version'], { async write() { writes++; throw failure; } }), error => error === failure);
  assert.equal(writes, 1);
});

test('public JSON budget failure is nonzero without an oversized stdout fallback', async context => {
  const cli = createPlaywrightCli({ limits: { maxCommandBytes: 1 } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
  context.after(() => shell.dispose());
  const result = await shell.exec('playwright-cli --json --version');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Playwright command byte limit exceeded/);
});
