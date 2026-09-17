import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
const { installPlaywrightNetworkPolicy } = await import(
  process.env.SAFE_BASH_NETWORK_POLICY_MODULE || new URL('../../src/playwright/network-policy.ts', import.meta.url).href
);

const modulePath = process.env.PLAYWRIGHT_TEST_MODULE;
const encoder = new TextEncoder();
const result = (body, status = 200, headers = []) => ({ status, headers: [{ name: 'content-type', value: 'text/html' }, ...headers], body: encoder.encode(body) });

test('native CDP redirects, popup admission, request bodies, cookies and cancellation', {
  skip: !modulePath && 'Set PLAYWRIGHT_TEST_MODULE and optionally PLAYWRIGHT_TEST_EXECUTABLE', timeout: 60000,
}, async t => {
  const { chromium } = await import(modulePath);
  const received = [];
  const forbidden = createServer((request, response) => { received.push(request.url); response.end('forbidden'); });
  const denyProxy = createServer((_request, response) => response.writeHead(502).end());
  denyProxy.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  const portReservation = createServer();
  for (const server of [forbidden, denyProxy, portReservation]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cdpPort = portReservation.address().port;
  await new Promise(resolve => portReservation.close(resolve));
  const forbiddenUrl = `http://127.0.0.1:${forbidden.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_TEST_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE } : {}),
    args: [`--remote-debugging-port=${cdpPort}`, `--proxy-server=http://127.0.0.1:${denyProxy.address().port}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  const metadata = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const socket = new WebSocket(metadata.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const requests = [];
  const failures = [];
  const canceled = [];
  let holdRetirement;
  let policy;
  try {
    policy = await installPlaywrightNetworkPolicy({
      socket, directNetwork: 'blocked-by-host', retire: async () => { await holdRetirement; await browser.close(); }, requestTimeoutMs: 3000,
      onRequestFailure: failure => failures.push(failure),
      async fetch(request) {
        requests.push({ ...request, bytes: request.body && [...request.body], body: request.body && new TextDecoder().decode(request.body) });
        const url = new URL(request.url);
        if (!['allowed.example', 'other.example'].includes(url.hostname)) throw new Error('Forbidden destination');
        if (url.pathname === '/pending') return new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => { canceled.push(request.requestId); reject(request.signal.reason); }, { once: true });
        });
        if (url.pathname === '/worker.js') return result(`postMessage('worker-ran');fetch('${forbiddenUrl}/worker-escape')`, 200, [{ name: 'content-type', value: 'application/javascript' }]);
        if (url.pathname === '/form') return result(`<form method="post" action="/redirect/${url.searchParams.get('status')}"><input name="field" value="value"></form>`);
        if (url.pathname.startsWith('/redirect/')) return result('', Number(url.pathname.split('/')[2]), [
          { name: 'location', value: '/final' }, { name: 'set-cookie', value: 'hop=present; Path=/; Secure; SameSite=Lax' },
        ]);
        if (url.pathname === '/forbidden') return result('', Number(url.searchParams.get('status') ?? 302), [{ name: 'location', value: `${forbiddenUrl}/hop` }]);
        if (url.pathname === '/nested') return result('', 301, [{ name: 'location', value: '/redirect/307' }]);
        if (url.pathname === '/page') return result(`<title>Root</title><iframe src="https://other.example/frame"></iframe><img src="/forbidden?status=302"><script>window.open('/popup')</script>`);
        if (url.pathname === '/frame') return result(`<title>Frame</title><iframe src="https://allowed.example/forbidden"></iframe>`);
        if (url.pathname === '/popup') return result(`<title>Popup</title><script>window.open('${forbiddenUrl}/nested-popup');window.open('/forbidden')</script>`);
        if (url.pathname === '/auth') return result('', 302, [{ name: 'location', value: 'https://other.example/final' }, { name: 'access-control-allow-origin', value: 'https://allowed.example' }]);
        if (request.method === 'OPTIONS') return result('', 204, [{ name: 'access-control-allow-origin', value: 'https://allowed.example' }, { name: 'access-control-allow-headers', value: 'authorization' }]);
        return result('<title>Final</title><img src="relative.png">', 200, [{ name: 'access-control-allow-origin', value: 'https://allowed.example' }]);
      },
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const status of [301, 302, 303, 307, 308]) await t.test(`POST ${status}`, async () => {
      await context.clearCookies();
      await page.goto(`https://allowed.example/form?status=${status}`);
      const start = requests.length;
      await Promise.all([page.waitForURL('https://allowed.example/final'), page.evaluate(() => globalThis.document.querySelector('form').submit())]);
      assert.equal(page.url(), 'https://allowed.example/final');
      const chain = requests.slice(start).filter(request => ['/final', `/redirect/${status}`].includes(new URL(request.url).pathname));
      assert.equal(chain.length, 2);
      assert.equal(chain[0].method, 'POST');
      assert.equal(chain[0].body, 'field=value');
      assert.equal(chain[1].method, status === 307 || status === 308 ? 'POST' : 'GET');
      assert.equal(chain[1].body, status === 307 || status === 308 ? 'field=value' : undefined);
      assert.ok(chain[1].headers.some(h => h.name.toLowerCase() === 'cookie' && h.value.includes('hop=present')), 'redirect cookie reaches the next hop');
    });
    await t.test('all redirect codes reject forbidden targets before network work', async () => {
      for (const status of [301, 302, 303, 307, 308]) {
        const deniedPage = await context.newPage();
        await assert.rejects(deniedPage.goto(`https://allowed.example/forbidden?status=${status}`, { timeout: 5000 }));
        await deniedPage.close();
      }
      assert.deepEqual(received, []);
      assert.ok(failures.some(f => f.message === 'Forbidden destination' && f.targetId && f.frameId && f.requestId));
    });
    await t.test('nested redirects and relative resources retain native origin', async () => {
      await page.goto('https://allowed.example/nested');
      assert.equal(page.url(), 'https://allowed.example/final');
      assert.equal(await page.evaluate(() => globalThis.location.origin), 'https://allowed.example');
      assert.ok(requests.some(request => request.url === 'https://allowed.example/relative.png'));
    });
    await t.test('cross-origin redirect strips Authorization and origin cookies', async () => {
      await page.goto('https://allowed.example/final');
      const start = requests.length;
      await page.evaluate(async () => { await fetch('/auth', { headers: { Authorization: 'Bearer fixture' } }); });
      const final = requests.slice(start).find(request => request.url === 'https://other.example/final');
      assert.ok(final);
      assert.equal(final.headers.some(h => ['authorization', 'cookie'].includes(h.name.toLowerCase())), false);
    });
    await t.test('307 and 308 preserve non-UTF-8 binary request bytes', async () => {
      for (const status of [307, 308]) {
        const start = requests.length;
        await page.evaluate(async status => { await fetch(`/redirect/${status}`, { method: 'POST', body: new Uint8Array([0, 255, 128, 65]) }); }, status);
        const chain = requests.slice(start).filter(request => request.method === 'POST');
        assert.equal(chain.length, 2);
        assert.deepEqual(chain.map(request => request.bytes), [[0, 255, 128, 65], [0, 255, 128, 65]]);
      }
    });
    await t.test('frames, popup first requests and nested popups remain mediated', async () => {
      await page.goto('https://allowed.example/page');
      await page.waitForTimeout(250);
      assert.ok(requests.some(request => request.url === 'https://other.example/frame'));
      assert.ok(requests.some(request => request.url === `${forbiddenUrl}/nested-popup`));
      assert.deepEqual(received, []);
      for (const extra of context.pages()) if (extra !== page) await extra.close();
    });
    await t.test('canceling a browser request aborts its pending host work', async () => {
      await page.goto('https://allowed.example/final');
      await page.evaluate(() => {
        const controller = new AbortController();
        globalThis.cancelFixture = () => controller.abort();
        fetch('/pending', { signal: controller.signal }).catch(() => {});
      });
      await page.waitForTimeout(50);
      await page.evaluate(() => globalThis.cancelFixture());
      await page.waitForTimeout(50);
      assert.equal(canceled.length, 1);
    });
    await t.test('concurrent contexts retain their cookies and cancellation ownership', async () => {
      const sibling = await browser.newContext();
      const siblingPage = await sibling.newPage();
      await sibling.addCookies([{ name: 'owner', value: 'sibling', url: 'https://allowed.example' }]);
      await context.addCookies([{ name: 'owner', value: 'original', url: 'https://allowed.example' }]);
      const start = requests.length;
      await Promise.all([page.goto('https://allowed.example/final?owner=original'), siblingPage.goto('https://allowed.example/final?owner=sibling')]);
      for (const owner of ['original', 'sibling']) {
        const request = requests.slice(start).find(request => request.url.endsWith(`?owner=${owner}`));
        assert.ok(request.headers.some(h => h.name.toLowerCase() === 'cookie' && h.value.includes(`owner=${owner}`)));
      }
      const pendingRequest = siblingPage.goto('https://allowed.example/pending').catch(() => {});
      await siblingPage.waitForTimeout(50);
      await sibling.close();
      await pendingRequest;
      await page.goto('https://allowed.example/final');
      assert.equal(canceled.length, 2);
    });
    await t.test('unsupported worker stays paused until its owner terminates it', async () => {
      const messages = await page.evaluate(async () => {
        const messages = [];
        const worker = new globalThis.Worker('/worker.js');
        worker.onmessage = event => messages.push(event.data);
        await new Promise(resolve => setTimeout(resolve, 100));
        worker.terminate();
        return messages;
      });
      assert.deepEqual(messages, []);
      assert.deepEqual(received, []);
    });
    await t.test('independent direct-network denial survives policy transport loss', async () => {
      let releaseRetirement;
      holdRetirement = new Promise(resolve => { releaseRetirement = resolve; });
      socket.close();
      await new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
      // Deliberately keep the live browser after policy death: a close callback
      // cannot be the network boundary if the host isolate itself disappears.
      try {
        await page.evaluate(async url => { await fetch(url).catch(() => {}); }, `${forbiddenUrl}/after-policy-loss`);
        await page.goto(`${forbiddenUrl}/navigation-after-policy-loss`, { timeout: 2000 }).catch(() => {});
        assert.deepEqual(received, []);
      } finally { releaseRetirement(); }
      await policy.dispose();
      assert.equal(browser.isConnected(), false);
      assert.deepEqual(received, []);
    });
    t.diagnostic(JSON.stringify({ browser: metadata.Browser, requestCount: requests.length, failures, forbiddenReceived: received }));
  } finally {
    if (policy) await policy.dispose();
    else { socket.close(); await browser.close(); }
    for (const server of [forbidden, denyProxy]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
