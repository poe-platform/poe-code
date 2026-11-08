import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import { installPlaywrightNetworkPolicy, type PlaywrightPolicyRequest } from '../../src/playwright/network-policy.js';
import { bindPlaywrightRoutePolicy, playwrightRouteAbilities } from '../../src/playwright/route-capabilities.js';
import { playwrightStandardAbilities } from '../../src/playwright/standard-capabilities.js';

test('standard routes compose with native guarded policy without competing interception', { skip: !process.env.PLAYWRIGHT_TEST_MODULE, timeout: 30_000 }, async suite => {
  assert.ok(process.env.TMPDIR?.startsWith('/home/'));
  const native = await import(process.env.PLAYWRIGHT_TEST_MODULE!);
  const serverRequests: string[] = [];
  const server = createServer((request, response) => {
    serverRequests.push(request.url!);
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/redirect') { response.writeHead(302, { location: 'http://forbidden.example/blocked' }); response.end(); }
    else if (request.url === '/headers') response.end(`<title>${request.headers['x-probe']}</title>`);
    else response.end('<title>transport</title>');
  });
  const proxy = createServer((_request, response) => { response.writeHead(403); response.end(); });
  proxy.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  for (const listener of [server, proxy]) await new Promise<void>(resolve => { listener.listen(0, '127.0.0.1', resolve); });
  suite.after(async () => {
    for (const listener of [server, proxy]) { listener.closeAllConnections(); await new Promise<void>(resolve => { listener.close(() => resolve()); }); }
  });
  const serverAddress = server.address(), proxyAddress = proxy.address();
  assert.ok(serverAddress && typeof serverAddress === 'object' && proxyAddress && typeof proxyAddress === 'object');
  const origin = `http://127.0.0.1:${serverAddress.port}`;
  const browser = await native.chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE,
    args: ['--remote-debugging-port=0', '--enable-automation', '--disable-dev-shm-usage', `--proxy-server=http://127.0.0.1:${proxyAddress.port}`, '--proxy-bypass-list=<-loopback>'],
  });
  suite.after(() => browser.close());
  const root = await browser.newBrowserCDPSession();
  const commandLine = await root.send('Browser.getBrowserCommandLine');
  const profile = commandLine.arguments.find((value: string) => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const readiness = AbortSignal.any([suite.signal, AbortSignal.timeout(5000)]);
  let endpoint: string | undefined;
  while (!endpoint) {
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), { encoding: 'utf8', signal: readiness })).trim().split('\n');
      if (port && path?.startsWith('/devtools/browser/')) endpoint = `ws://127.0.0.1:${port}${path}`;
    } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
    if (!endpoint) await delay(10, undefined, { signal: readiness });
  }
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const contexts = [await browser.newContext(), await browser.newContext()];
  const targets = [new Set<string>(), new Set<string>()];
  const contextIds = new Map<object, string>();
  const owners = new Map<string, ReturnType<typeof bindPlaywrightRoutePolicy>>();
  const admissions: PlaywrightPolicyRequest[] = [];
  const downstream: string[] = [];
  let released = 0;
  let releaseHeld: (() => void) | undefined;
  let heldStarted!: () => void;
  const heldReady = new Promise<void>(resolve => { heldStarted = resolve; });
  const bindings = contexts.map((context, index) => bindPlaywrightRoutePolicy(context, {
    ownsRequest: request => targets[index]!.has(request.targetId),
    async admit(request) {
      admissions.push(request);
      assert.equal(new URL(request.url).origin, origin, 'host URL admission');
      assert.ok(!request.headers.some(header => header.name.toLowerCase() === 'host' && header.value === 'forbidden.example'), 'host authority admission');
    },
    async fetch(request) {
      downstream.push(request.url);
      if (new URL(request.url).pathname === '/held') {
        heldStarted();
        await new Promise<void>(resolve => { releaseHeld = resolve; });
        return { status: 200, headers: [], body: new Uint8Array(), release() { released++; } };
      }
      const response = await fetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers.map(({ name, value }) => [name, value])), redirect: 'manual', signal: request.signal });
      return { status: response.status, headers: [...response.headers].map(([name, value]) => ({ name, value })), body: new Uint8Array(await response.arrayBuffer()), release() { released++; } };
    },
  }));
  suite.after(async () => { releaseHeld?.(); for (const binding of bindings) await binding.dispose(); });
  const policy = await installPlaywrightNetworkPolicy({ socket, directNetwork: 'http-blocked-by-host', requestTimeoutMs: 3000, retire: () => browser.close(), fetch: request => (owners.get(request.targetId) ?? bindings[0]!).fetch(request) });
  suite.after(() => policy.dispose());
  const newPage = async (index = 0) => {
    const context = contexts[index]!;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    assert.equal(targetInfo.type, 'page');
    assert.ok(targetInfo.browserContextId);
    if (contextIds.has(context)) assert.equal(targetInfo.browserContextId, contextIds.get(context));
    else contextIds.set(context, targetInfo.browserContextId);
    targets[index]!.add(targetInfo.targetId);
    owners.set(targetInfo.targetId, bindings[index]!);
    page.on('close', () => { targets[index]!.delete(targetInfo.targetId); owners.delete(targetInfo.targetId); });
    await cdp.detach();
    return page;
  };
  const page = await newPage();
  const cleanups: (() => Promise<void>)[] = [];
  const run = async (command: PlaywrightAbilityRequest['command'], args: string[] = [], options: PlaywrightAbilityRequest['options'] = {}) => {
    const request: PlaywrightAbilityRequest = { command, args, options, session: 'not-an-ownership-credential', signal: suite.signal,
      limits: { maxCommandBytes: 1024 * 1024, maxArtifactBytes: 1024 * 1024 },
      browserSession: { context: contexts[0], page, registerCleanup(cleanup) { cleanups.push(cleanup); }, async resolveTarget() { throw new Error('unused'); }, async selectPage() {} },
      async write() {}, async readFile() { throw new Error('unused'); }, async writeArtifact() { throw new Error('unused'); }, registerCleanup() {},
    };
    return (playwrightRouteAbilities[command] ?? playwrightStandardAbilities[command])!.execute(request);
  };
  await run('route', ['**/mock'], { status: '201', body: '<title>mock</title>', 'content-type': 'text/html' });
  const response = await page.goto(`${origin}/mock`);
  assert.equal(response.status(), 201);
  assert.equal(await page.title(), 'mock');
  assert.ok(!downstream.includes(`${origin}/mock`));
  const other = await newPage(1);
  assert.notEqual(contextIds.get(contexts[0]), contextIds.get(contexts[1]));
  await other.goto(`${origin}/mock`);
  assert.equal(await other.title(), 'transport');
  await run('route', ['**/blocked'], { body: '<title>must not bypass</title>', 'content-type': 'text/html' });
  const blocked = await newPage();
  await assert.rejects(blocked.goto('http://forbidden.example/blocked'));
  assert.ok(admissions.some(request => request.url === 'http://forbidden.example/blocked'));
  await blocked.close();
  await run('route', ['**/headers'], { header: 'X-Probe: rewritten' });
  await page.goto(`${origin}/headers`);
  assert.equal(await page.title(), 'rewritten');
  assert.equal(admissions.filter(request => request.url === `${origin}/headers`).length, 2);
  await run('route', ['**/denied-header'], { header: 'Host: forbidden.example' });
  const deniedHeader = await newPage();
  await assert.rejects(deniedHeader.goto(`${origin}/denied-header`));
  assert.ok(!downstream.includes(`${origin}/denied-header`));
  await deniedHeader.close();
  const redirect = await newPage();
  await assert.rejects(redirect.goto(`${origin}/redirect`));
  assert.ok(!downstream.some(url => new URL(url).hostname === 'forbidden.example'));
  await redirect.close();
  await run('network-state-set', ['offline']);
  const offline = await newPage();
  await assert.rejects(offline.goto(`${origin}/offline`));
  assert.ok(!serverRequests.includes('/offline'));
  await offline.close();
  await run('route', ['**/offline-mock'], { body: '<title>offline mock</title>', 'content-type': 'text/html' });
  await page.goto(`${origin}/offline-mock`);
  assert.equal(await page.title(), 'offline mock');
  await run('network-state-set', ['online']);
  await run('unroute');
  await page.goto(`${origin}/mock`);
  assert.equal(await page.title(), 'transport');
  const oracleBrowser = await native.chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE,
    args: ['--disable-dev-shm-usage', `--proxy-server=http://127.0.0.1:${proxyAddress.port}`, '--proxy-bypass-list=<-loopback>'],
  });
  suite.after(() => oracleBrowser.close());
  const oracleContext = await oracleBrowser.newContext();
  await oracleContext.route('**/*', (route: any) => route.fulfill({ contentType: 'text/html', body: '<title>transport</title>' }));
  const oraclePage = await oracleContext.newPage();
  const patterns = [
    ['**/api', '/api'], ['**/api', '/api/nested'], ['**/*.{png,jpg}', '/image.png'],
    ['**/{api,users}', '/users'], ['**/api/**/item', '/api/item'], ['**/api/**/item', '/api/a/item'],
    ['**/api/*', '/api/a/b'], ['**/question?mark', '/question?mark'], ['**/literal\\*', '/literal*'],
  ] as const;
  for (const [pattern, path] of patterns) {
    const handler = (route: any) => route.fulfill({ contentType: 'text/html', body: '<title>pattern-hit</title>' });
    await oracleContext.route(pattern, handler);
    await run('route', [pattern], { body: '<title>pattern-hit</title>', 'content-type': 'text/html' });
    await page.goto(origin + path);
    await oraclePage.goto(origin + path);
    assert.equal(await page.title(), await oraclePage.title(), JSON.stringify({ pattern, path }));
    await run('unroute', [pattern]);
    await oracleContext.unroute(pattern, handler);
  }
  await oracleBrowser.close();
  const pending = page.goto(`${origin}/held`);
  const canceled = assert.rejects(pending);
  await heldReady;
  await contexts[0].close();
  let disposed = false;
  const disposal = bindings[0]!.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(disposed, false);
  releaseHeld!();
  await canceled;
  await disposal;
  await other.goto(`${origin}/sibling-alive`);
  assert.equal(await other.title(), 'transport');
  for (const cleanup of cleanups) await cleanup();
  await bindings[1]!.dispose();
  assert.equal(released, downstream.length);
  suite.diagnostic(JSON.stringify({ chromium: browser.version(), admissions: admissions.length, downstream: downstream.length, released, nativeGlobCases: patterns.length, qualification: 'local native guarded route backend; no Cloudflare deployment or published-package claim' }));
});
