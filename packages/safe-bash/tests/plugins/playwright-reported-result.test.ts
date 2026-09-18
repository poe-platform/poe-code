import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import { createPlaywrightCli } from '../../src/commands/playwright/index.js';
import { serializePlaywrightResult } from '../../src/playwright/response.js';
import type { PlaywrightCommandResult } from '../../src/playwright/response.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfilled => { resolve = fulfilled; });
  return { promise, resolve };
}

const failureResult = {
  isError: true,
  sections: [{ title: 'Error' as const, content: 'Error: native page evaluation failed' }],
};

for (const mode of ['', '--json', '--raw']) {
  test(`fully written ${mode || 'text'} error returns exit1 without duplicate stderr`, async context => {
    const cli = createPlaywrightCli({ abilities: { list: { scope: 'client', async execute() { return failureResult; } } } });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
    context.after(() => shell.dispose());
    const result = await shell.exec(`playwright-cli ${mode} list`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, mode === '--json'
      ? '{\n  "isError": true,\n  "error": "Error: native page evaluation failed"\n}\n'
      : (mode ? '' : '### Error\n') + 'Error: native page evaluation failed\n');
  });
}

test('standard JSON omits code while preserving result/page/snapshot fields', () => {
  const result: PlaywrightCommandResult = { sections: [
    { title: 'Result', content: '2' },
    { title: 'Ran Playwright code', content: "await page.evaluate('1+1');", codeframe: 'js' },
    { title: 'Page', content: '- Page URL: about:blank' },
    { title: 'Snapshot', content: '- [Snapshot](snapshot.yml)' },
  ] };
  assert.deepEqual(JSON.parse(serializePlaywrightResult(result, { json: true, raw: false })), {
    result: '2', page: '- Page URL: about:blank', snapshot: { file: 'snapshot.yml' },
  });
  assert.match(serializePlaywrightResult(result, { json: false, raw: false }), /### Ran Playwright code\n```js\n/);
});

test('explicit error metadata survives controller response formatting', async context => {
  const cli = createPlaywrightCli({ abilities: { list: { scope: 'client', async execute() {
    return { isError: true, sections: [{ title: 'Result', content: 'request rejected' }] };
  } } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
  context.after(() => shell.dispose());
  const result = await shell.exec('playwright-cli --json list');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { isError: true, result: 'request rejected' });
});

test('explicit raw error header applies to target errors but not execution errors', async context => {
  for (const rawErrorHeader of [false, true]) {
    const cli = createPlaywrightCli({ abilities: { list: { scope: 'client', async execute() { return { ...failureResult, rawErrorHeader }; } } } });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
    context.after(() => shell.dispose());
    const result = await shell.exec('playwright-cli --raw list');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, (rawErrorHeader ? '### Error\n' : '') + 'Error: native page evaluation failed\n');
    assert.equal(result.stderr, '');
  }
});

for (const failure of ['sink', 'budget', 'cleanup'] as const) {
  test(`${failure} failure cannot be mistaken for an already emitted error`, async context => {
    const original = new Error(failure + ' failed');
    const controller = createPlaywrightController({ limits: { maxCommandBytes: failure === 'budget' ? 1 : 1024 }, abilities: {
      list: { scope: 'client', async execute(request) {
        if (failure === 'cleanup') request.registerCleanup(async () => { throw original; });
        return failureResult;
      } },
    } });
    context.after(() => controller.dispose());
    let writes = 0;
    await assert.rejects(controller.run({ args: ['--json', 'list'], env: {}, signal: new AbortController().signal,
      async write() { writes++; if (failure === 'sink') throw original; },
    }), error => failure === 'budget' ? error instanceof PlaywrightResourceLimitError : error === original);
    assert.equal(writes, failure === 'sink' ? 1 : 0);
  });
}

for (const termination of ['none', 'root', 'dispose'] as const) {
  test(`pending structured error output remains owned through ${termination}`, async () => {
    const started = deferred();
    const sink = deferred();
    const root = new AbortController();
    const rootFailure = new Error('caller aborted');
    const controller = createPlaywrightController({ abilities: { list: { scope: 'client', async execute() { return failureResult; } } } });
    let registered = false;
    let complete = false;
    let disposed = false;
    const running = controller.run({ args: ['--json', 'list'], env: {}, signal: root.signal,
      registerCleanup() { registered = true; },
      async write() { assert.ok(registered); started.resolve(); await sink.promise; },
    });
    const outcome = running.then(() => undefined, error => error).finally(() => { complete = true; });
    await started.promise;
    if (termination === 'root') root.abort(rootFailure);
    const disposal = termination === 'dispose' ? controller.dispose().finally(() => { disposed = true; }) : undefined;
    await setImmediate();
    assert.equal(complete, false);
    assert.equal(disposed, false);
    sink.resolve();
    const failure = await outcome;
    if (termination === 'root') assert.equal(failure, rootFailure);
    else assert.equal(failure?.name, termination === 'none' ? 'PlaywrightReportedError' : 'Error');
    await (disposal ?? controller.dispose());
  });
}

test('a similarly named ordinary error is not suppressed by the public wrapper', async context => {
  const cli = createPlaywrightCli({ abilities: { list: { scope: 'client', async execute() {
    const failure = new Error('unreported failure');
    failure.name = 'PlaywrightReportedError';
    throw failure;
  } } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
  context.after(() => shell.dispose());
  const result = await shell.exec('playwright-cli list');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unreported failure/);
});
