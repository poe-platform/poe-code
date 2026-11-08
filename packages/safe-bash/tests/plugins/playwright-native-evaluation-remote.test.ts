import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const runtime = process.env.SAFE_BASH_REMOTE_REVIEW_RUNTIME;
const cloudflare = process.env.SAFE_BASH_REMOTE_REVIEW_CF === '1';
interface Outcome { stdout: string; stderr: string; exitCode: number }
const cases = [
  { expression: '1 + 2' }, { expression: '() => ({ answer: 42 })' },
  { expression: 'Promise.resolve("世界")' }, { expression: 'async () => undefined' },
  { expression: '() => { globalThis.nativeEvalMarker = 42; return 42; }' },
  { expression: 'new Date("2020-01-01T00:00:00.000Z")' },
  { expression: 'new Uint8Array([1,2])' }, { expression: 'new Map([["a",1]])' },
  { expression: '({toJSON(){return 1}})' }, { expression: '() => () => 1' },
  { expression: '({ value: undefined, symbol: Symbol("s") })' },
  { expression: 'element => element.id', target: '#one' },
  { expression: '({ answer: 42 })', filename: 'answer.json' },
  { expression: 'Promise.reject("bad")' }, { expression: '1n' },
  { expression: '(() => { const item={}; item.self=item; return item; })()' },
  { expression: '1', target: '#missing' }, { expression: 'document' },
  { expression: 'window' }, { expression: 'document.querySelector("#one")' },
  { expression: 'new Error("value")' },
  { expression: 'Object.create({ toJSON() { return 42; } })' },
  { expression: '({ get broken() { throw new Error("getter"); }, okay: 2 })' },
  { expression: '[NaN, Infinity, -Infinity, -0, undefined, Symbol("s")]' },
  { expression: 'new Date(NaN)' }, { expression: 'new URL("https://fixture.example/path")' },
  { expression: 'new ArrayBuffer(32)' }, { expression: '/example/gi' },
];

const driver = `
import { createPlaywrightCli } from '@review/command';
import { createPlaywrightAdapter } from '@review/adapter';
import { createMemoryFileSystem } from '@review/filesystem';
export async function review(browser, origins, cases) {
  const fs = createMemoryFileSystem();
  const client = createPlaywrightCli({ adapter: createPlaywrightAdapter({ chromium: { async acquireBrowser() { return { browser, async release() {} }; } } }) });
  let command;
  client.plugin.setup({ commands: { register(definition) { command = definition; } } });
  const run = async (args, signal = new AbortController().signal) => {
    let stdout = ''; let stderr = '';
    const cleanup = [];
    let result;
    try { result = await command.execute({ args, env: {}, cwd: '/', fs, signal, registerCleanup: operation => cleanup.push(operation), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } }); }
    finally { for (const operation of cleanup) await operation(); }
    return { stdout, stderr, exitCode: result.exitCode };
  };
  const results = [];
  try {
    await fs.writeFile('/config.json', new TextEncoder().encode(JSON.stringify({ timeouts: { action: 250, navigation: 5000, settle: 0 } })));
    const opened = await run(['open', origins[0], '--config=config.json']);
    if (opened.exitCode) throw new Error(JSON.stringify(opened));
    for (const entry of cases) for (const flags of [[], ['--json'], ['--raw']]) {
      const result = await run(['eval', entry.expression, ...(entry.target ? [entry.target] : []), ...(entry.filename ? ['--filename', entry.filename] : []), ...flags]);
      results.push({ entry, flags, ...result });
      if (!client.inspectSessions().length) throw new Error('Eval unexpectedly retired session: ' + JSON.stringify(result));
    }
    const diagnostics = [];
    for (const expression of ['() => { throw new Error("boom"); }', '(() =>']) for (const flags of [[], ['--json'], ['--raw']]) diagnostics.push({ expression, flags, ...await run(['eval', expression, ...flags]) });
    const bounds = [];
    for (const expression of ['"x".repeat(2 * 1024 * 1024)', 'Promise.reject("x".repeat(2 * 1024 * 1024))', 'Array(10001).fill(1)']) {
      await run(['close']);
      const opened = await run(['open', origins[0], '--config=config.json']);
      if (opened.exitCode) throw new Error(JSON.stringify(opened));
      const page = client.inspectSessions()[0].selectedPage;
      const acquire = page.evaluateHandle.bind(page);
      const transferred = [];
      page.evaluateHandle = async (...args) => {
        const handle = await acquire(...args);
        const serialize = handle.evaluate.bind(handle);
        handle.evaluate = async (...parameters) => { const value = await serialize(...parameters); transferred.push(value); return value; };
        return handle;
      };
      bounds.push({ ...await run(['eval', expression, '--filename=overflow.json']), transferred });
    }
    await run(['close']);
    const openedForCancel = await run(['open', origins[0], '--config=config.json']);
    if (openedForCancel.exitCode) throw new Error(JSON.stringify(openedForCancel));
    const page = client.inspectSessions()[0].selectedPage;
    const cancellation = new AbortController();
    const pending = run(['eval', 'async () => { globalThis.nativeEvalPending = true; await new Promise(() => {}); }', '--filename=canceled.json'], cancellation.signal)
      .then(result => ({ result }), error => ({ error: error.message }));
    const ready = await page.waitForFunction(() => globalThis.nativeEvalPending, null, { timeout: 3000 });
    await ready.dispose();
    cancellation.abort(new Error('Evaluation canceled by owner'));
    const canceled = await pending;
    const artifactsAbsent = await Promise.all(['overflow.json', 'canceled.json'].map(async name => { try { await fs.stat('/' + name); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }));
    return { results, diagnostics, bounds, canceled, artifactsAbsent, noSessions: client.inspectSessions().length === 0, artifact: new TextDecoder().decode(await fs.readFile('/answer.json')) };
  } finally { await client.dispose(); }
}
`;

test(`remote native eval differential: ${cloudflare ? 'actual CF adapter, local workerd' : 'actual Chromium'}`, { skip: !runtime, timeout: 180_000 }, async context => {
  const out = process.env.SAFE_BASH_REMOTE_REVIEW_OUT;
  const executablePath = process.env.SAFE_BASH_REMOTE_REVIEW_CHROMIUM;
  assert.ok(out && out.startsWith('/home/') && executablePath && process.env.TMPDIR?.startsWith('/home/'));
  const require = createRequire(resolve(runtime!, 'package.json'));
  assert.equal(require('@playwright/cli/package.json').version, '0.1.20');
  assert.equal(require('playwright/package.json').version, '1.64.0-alpha-2026-09-14');
  const origins = await Promise.all(['active', 'historical'].map(async () => {
    const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Remote review</title><button id="one">One</button><button>Two</button>'); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    context.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }));
  await mkdir(out, { recursive: true });
  const directory = await mkdtemp(join(out, 'remote-'));
  const config = join(directory, 'config.json');
  await writeFile(config, JSON.stringify({ browser: { browserName: 'chromium', launchOptions: { executablePath, headless: true } } }));
  const oracle = async (args: string[]) => {
    try { return { ...await promisify(execFile)(process.execPath, [require.resolve('@playwright/cli/playwright-cli.js'), '-s=' + basename(directory), ...args], { cwd: directory, env: process.env, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }), exitCode: 0 }; }
    catch (error) { const failure = error as { stdout: string; stderr: string; code: number }; return { stdout: failure.stdout, stderr: failure.stderr, exitCode: failure.code }; }
  };
  const opened = await oracle(['open', origins[0]!, '--config', config]);
  assert.equal(opened.exitCode, 0, JSON.stringify(opened));
  context.after(async () => { await oracle(['close']); });
  const expected: Outcome[] = [];
  for (const entry of cases) for (const flags of [[], ['--json'], ['--raw']]) expected.push(await oracle(['eval', entry.expression, ...(entry.target ? [entry.target] : []), ...(entry.filename ? ['--filename', entry.filename] : []), ...flags]));
  const expectedDiagnostics = [];
  for (const expression of ['() => { throw new Error("boom"); }', '(() =>']) for (const flags of [[], ['--json'], ['--raw']]) expectedDiagnostics.push({ expression, flags, ...await oracle(['eval', expression, ...flags]) });
  const { build } = require('esbuild');
  const alias = { '@review/command': resolve('packages/safe-bash/src/commands/playwright/index.ts'), '@review/adapter': resolve('packages/safe-bash/src/playwright/adapter.ts'), '@review/filesystem': resolve('packages/safe-fs/src/core.ts'), '@poe-code/safe-fs/core': resolve('packages/safe-fs/src/core.ts') };
  let report;
  if (cloudflare) {
    assert.equal(require(resolve(runtime!, 'node_modules/@cloudflare/playwright/package.json')).version, '1.3.6');
    const worker = driver + `
import { acquire, connect, sessions } from '@cloudflare/playwright';
export default { async fetch(request, env) {
  const { origins, cases } = await request.json();
  const { sessionId } = await acquire(env.BROWSER);
  const browser = await connect(env.BROWSER, sessionId);
  let result;
  try { result = await review(browser, origins, cases); }
  finally { await browser.close(); const removed = await env.BROWSER.fetch('http://browser/v1/devtools/browser/' + encodeURIComponent(sessionId), { method: 'DELETE' }); if (!removed.ok) throw new Error('Browser retirement failed'); }
  result.sessionAbsent = !(await sessions(env.BROWSER)).some(entry => entry.sessionId === sessionId);
  return Response.json(result);
} };`;
    const bundle = await build({ stdin: { contents: worker, resolveDir: process.cwd() }, alias, nodePaths: [resolve(runtime!, 'node_modules')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'] });
    const { Miniflare } = require('miniflare');
    const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' } });
    try {
      await miniflare.ready;
      const response = await miniflare.dispatchFetch('http://fixture/review', { method: 'POST', body: JSON.stringify({ origins, cases }) });
      assert.equal(response.status, 200, (await response.clone().text()).slice(0, 2000));
      report = await response.json();
    } finally { await miniflare.dispose(); }
  } else {
    const bundle = await build({ stdin: { contents: driver, resolveDir: process.cwd() }, alias, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
    const path = join(directory, 'candidate.mjs');
    await writeFile(path, bundle.outputFiles[0].text);
    const { review } = await import(pathToFileURL(path).href);
    const browser = await require('playwright').chromium.launch({ executablePath, headless: true });
    try { report = await review(browser, origins, cases); }
    finally { await browser.close(); }
  }
  const mismatches = report.results.flatMap((actual: { stdout: string; stderr: string; exitCode: number; entry: unknown; flags: string[] }, index: number) => JSON.stringify({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }) === JSON.stringify(expected[index]) ? [] : [{ index, expected: expected[index], actual }]);
  const sourceHashes = Object.fromEntries(await Promise.all(['native-evaluation.ts', 'standard-capabilities.ts', 'controller.ts', 'response.ts', 'ability-execution.ts'].map(async filename => [filename, createHash('sha256').update(await readFile(resolve('packages/safe-bash/src/playwright', filename))).digest('hex')])));
  await writeFile(join(directory, 'report.json'), JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes, scope: cloudflare ? 'Worktree source candidate: actual CF1.3.6 local workerd, not deployed' : 'Worktree source candidate: actual native Chromium', expected, expectedDiagnostics, report, mismatches }, null, 2));
  context.diagnostic(`${mismatches.length}/${expected.length} eval mismatches; evidence ${directory}`);
  assert.equal(report.artifact, await readFile(join(directory, 'answer.json'), 'utf8'));
  if (cloudflare) assert.equal(report.sessionAbsent, true);
  for (const result of report.diagnostics) {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, '');
    if (result.flags.includes('--json')) assert.equal(JSON.parse(result.stdout).isError, true);
    else assert.match(result.stdout, /Error:/);
  }
  for (const result of report.bounds) {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /result.*limit/);
    assert.equal(result.transferred.length, 1);
    assert.equal(result.transferred[0].status, 'limit');
    assert.ok(new TextEncoder().encode(JSON.stringify(result.transferred)).byteLength < 256);
  }
  assert.match(report.canceled.error, /canceled by owner/);
  assert.equal(report.noSessions, true);
  assert.deepEqual(report.artifactsAbsent, [true, true]);
  assert.equal(mismatches.length, 0, 'exact pinned default/JSON/raw eval differential');
});
