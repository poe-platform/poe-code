import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
const modulePath = process.env.PLAYWRIGHT_TEST_MODULE;
const executablePath = process.env.PLAYWRIGHT_TEST_EXECUTABLE;
const sourcePath = fileURLToPath(new URL('../../src/playwright/private-target-transport.ts', import.meta.url));
const skip = (!runtimeRoot || !modulePath || !executablePath) && 'Set explicit installed CF runtime, Playwright module, and Chromium executable paths';

function makeControl(socket) {
  let sequence = 0;
  const pending = new Map();
  const destroyed = new Set();
  const closing = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Target.targetDestroyed') {
      const targetId = message.params.targetId;
      destroyed.add(targetId);
      const waiter = closing.get(targetId);
      if (waiter) { clearTimeout(waiter.timer); closing.delete(targetId); waiter.resolve(); }
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Native control closed'));
    }
    pending.clear();
    for (const waiter of closing.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Native control closed before target destruction'));
    }
    closing.clear();
  });
  return {
    waitForDestruction(targetId) {
      if (destroyed.has(targetId)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { closing.delete(targetId); reject(new Error('Owned target destruction timed out')); }, 5000);
        closing.set(targetId, { resolve, reject, timer });
      });
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native ${method} timed out`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
  };
}

async function storage({ writeKey, localValue, idbValue }) {
  if (writeKey) localStorage.setItem(writeKey, localValue);
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('private-native', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const idb = await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readwrite');
      const store = transaction.objectStore('values');
      if (writeKey) store.put(idbValue, writeKey);
      const original = store.get('original');
      const scratch = store.get('scratch');
      transaction.oncomplete = () => resolve({ original: original.result, scratch: scratch.result });
      transaction.onerror = () => reject(transaction.error);
    });
    return { local: localStorage.getItem('original'), scratchLocal: localStorage.getItem('scratch'), idb };
  } finally { database.close(); }
}

async function exercise(browser, control, adapter, origin) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await control.send('Target.setDiscoverTargets', { discover: true });
  const context = await browser.newContext();
  const original = await context.newPage();
  await original.goto(`${origin}/original`);
  await original.evaluate(storage, { writeKey: 'original', localValue: 'local-original', idbValue: 'idb-original' });
  const originalSession = await context.newCDPSession(original);
  const { targetInfo: originalInfo } = await originalSession.send('Target.getTargetInfo');
  await originalSession.detach();
  await context.addInitScript(() => { globalThis.initScript = true; });
  const observer = await browser.newBrowserCDPSession();
  const seen = [];
  observer.on('Target.targetCreated', event => seen.push(event.targetInfo.targetId));
  await observer.send('Target.setDiscoverTargets', { discover: true });
  const outcomes = [];
  for (const mode of ['release', 'abort']) {
    const guard = adapter.beginCreation();
    const concurrent = context.newPage();
    concurrent.catch(() => {});
    let targetId;
    try {
      ({ targetId } = await control.send('Target.createTarget', { url: 'about:blank', background: true, browserContextId: originalInfo.browserContextId }));
      await new Promise(resolve => setTimeout(resolve, 50));
      guard.commit(targetId);
    } catch (error) { guard.fail(error); throw error; }
    const sibling = await concurrent;
    await sibling.goto(`${origin}/concurrent`);
    check(await sibling.evaluate(() => globalThis.initScript && globalThis.documentScript), 'Concurrent public page was affected');
    await sibling.close();
    const { sessionId } = await control.send('Target.attachToTarget', { targetId, flatten: true });
    const { targetInfo } = await control.send('Target.getTargetInfo', {}, sessionId);
    check(targetInfo.targetId === targetId && targetInfo.browserContextId === originalInfo.browserContextId, 'Native identity mismatch');
    await control.send('Emulation.setScriptExecutionDisabled', { value: true }, sessionId);
    await context.addInitScript(() => { globalThis.lateInitScript = true; });
    await control.send('Page.enable', {}, sessionId);
    await control.send('Page.navigate', { url: `${origin}/${mode}` }, sessionId);
    let markers;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await control.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,ready:document.readyState,init:typeof globalThis.initScript,late:typeof globalThis.lateInitScript,document:typeof globalThis.documentScript})', returnByValue: true }, sessionId);
      markers = JSON.parse(result.result.value);
      if (markers.url === `${origin}/${mode}` && markers.ready === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    check(markers.url === `${origin}/${mode}` && markers.ready === 'complete', 'Owned navigation incomplete');
    check(markers.init === 'undefined' && markers.late === 'undefined' && markers.document === 'undefined', 'Private script executed');
    check(context.pages().length === 1 && !seen.includes(targetId), 'Private page exposed to client');
    const visible = await observer.send('Target.getTargets');
    check(!visible.targetInfos.some(info => info.targetId === targetId), 'Private target enumeration leaked');
    const { frameTree } = await control.send('Page.getFrameTree', {}, sessionId);
    const { executionContextId } = await control.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'owned-storage' }, sessionId);
    const values = await control.send('Runtime.evaluate', { expression: `(${storage})(${JSON.stringify({ writeKey: 'scratch', localValue: 'local-scratch', idbValue: 'idb-scratch' })})`, contextId: executionContextId, awaitPromise: true, returnByValue: true }, sessionId);
    check(!values.exceptionDetails, 'Isolated-world storage failed');
    check(values.result.value.local === 'local-original' && values.result.value.idb.original === 'idb-original', 'Original storage is not shared');
    let releasePromise;
    const closed = control.waitForDestruction(targetId);
    closed.catch(() => {});
    const release = () => releasePromise ??= control.send('Target.closeTarget', { targetId }).then(async result => {
      check(result.success, 'Owned close failed');
      await closed;
    });
    const abort = new AbortController();
    const abortRelease = () => { void release().catch(() => {}); };
    abort.signal.addEventListener('abort', abortRelease, { once: true });
    if (mode === 'abort') abort.abort();
    await Promise.all([release(), release()]);
    abort.signal.removeEventListener('abort', abortRelease);
    check(!(await control.send('Target.getTargets')).targetInfos.some(info => info.targetId === targetId), 'Owned target survived release');
    outcomes.push({ mode, markers, sharedStorage: values.result.value, sameContext: true, hiddenFromClient: true, cleanup: true });
  }
  const finalStorage = await original.evaluate(storage, {});
  check(finalStorage.scratchLocal === 'local-scratch' && finalStorage.idb.scratch === 'idb-scratch', 'Original did not observe scratch writes');
  const originalState = await original.evaluate(() => ({ url: location.href, document: globalThis.documentScript, init: typeof globalThis.initScript }));
  check(originalState.url === `${origin}/original` && originalState.document && originalState.init === 'undefined', 'Original tab was altered');
  const finalSibling = await context.newPage();
  await finalSibling.goto(`${origin}/final`);
  check(await finalSibling.evaluate(() => globalThis.initScript && globalThis.lateInitScript && globalThis.documentScript), 'Later public page initialization changed');
  const { sessionId: retiredSession } = await observer.send('Target.attachToTarget', { targetId: originalInfo.targetId, flatten: true });
  await observer.send('Target.detachFromTarget', { sessionId: retiredSession });
  const clientId = -2147483647;
  const onmessage = adapter.transport.onmessage;
  const onclose = adapter.transport.onclose;
  let replyCount = 0;
  let rejectionCount = 0;
  let staleReply;
  let timer;
  const stale = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Native stale-session response timed out')), 5000);
    adapter.transport.onmessage = message => {
      if (message.id !== clientId) { onmessage?.(message); return; }
      replyCount++;
      staleReply = message;
      if (message.error) {
        rejectionCount++;
        reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      } else resolve(message.result);
    };
    adapter.transport.onclose = reason => {
      rejectionCount++;
      reject(new Error(`Transport retired on native stale session: ${reason}`));
      onclose?.(reason);
    };
  });
  stale.catch(() => {});
  let staleSession;
  try {
    adapter.transport.send({ id: clientId, sessionId: retiredSession, method: 'Runtime.evaluate', params: { expression: '1', returnByValue: true } });
    const [retired, sibling] = await Promise.allSettled([stale, finalSibling.evaluate(() => 42)]);
    check(retired.status === 'rejected' && retired.reason.code === -32001 && retired.reason.message === 'Session with given id not found.', 'Native stale-session error was not preserved');
    check(staleReply.sessionId === retiredSession && staleReply.result === undefined, 'Native stale-session reply lost command ownership');
    check(sibling.status === 'fulfilled' && sibling.value === 42, 'Sibling pending command was affected by stale-session response');
    check(await original.evaluate(() => location.href) === `${origin}/original`, 'Original target did not survive stale-session response');
    check(replyCount === 1 && rejectionCount === 1, 'Native stale-session pending rejection was not one-shot');
    staleSession = { error: staleReply.error, responseSessionMatched: true, replyCount, rejectionCount, siblingSurvived: true, originalSurvived: true };
  } finally {
    clearTimeout(timer);
    adapter.transport.onmessage = onmessage;
    adapter.transport.onclose = onclose;
  }
  await finalSibling.close();
  await observer.detach();
  await context.close();
  return { outcomes, originalUntouched: true, concurrentAndLaterPagesUnaffected: true, staleSession };
}

async function openSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return socket;
}

async function nativeHost(run) {
  assert.ok(process.env.TMPDIR?.startsWith('/home/'), 'Set home-only TMPDIR');
  const { chromium } = await import(modulePath);
  const server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Original</title><script>globalThis.documentScript=true</script>'));
  const reservation = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let owner;
  try {
    owner = await chromium.launch({ executablePath, headless: true, args: [`--remote-debugging-port=${port}`, '--disable-dev-shm-usage'] });
    const metadata = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    await run({ chromium, endpoint: metadata.webSocketDebuggerUrl, origin: `http://127.0.0.1:${server.address().port}`, version: metadata.Browser });
  } finally {
    await owner?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('production private transport shields actual Chromium native storage', { skip, timeout: 45000 }, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const bundle = await build({ entryPoints: [sourcePath], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const { createPlaywrightPrivateTargetTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  await nativeHost(async ({ chromium, endpoint, origin, version }) => {
    const socket = await openSocket(endpoint);
    const controlSocket = await openSocket(endpoint);
    const upstream = { send(message) { socket.send(JSON.stringify(message)); }, close() { socket.close(); } };
    socket.addEventListener('message', event => upstream.onmessage?.(JSON.parse(event.data)));
    socket.addEventListener('close', () => upstream.onclose?.('Native socket closed'));
    const adapter = createPlaywrightPrivateTargetTransport(upstream);
    let browser;
    try {
      browser = await chromium.connectOverCDP(adapter.transport);
      context.diagnostic(JSON.stringify({ version, result: await exercise(browser, makeControl(controlSocket), adapter, origin) }));
    } finally { await browser?.close(); controlSocket.close(); socket.close(); }
  });
});

test('Cloudflare public binding bridge shields actual Chromium from workerd', { skip, timeout: 45000 }, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  const versions = Object.fromEntries(['@cloudflare/playwright', 'miniflare', 'workerd'].map(name => [name, require(resolve(runtimeRoot, 'node_modules', name, 'package.json')).version]));
  const worker = `
    import { connect } from '@cloudflare/playwright';
    import { createPlaywrightPrivateTargetTransport } from ${JSON.stringify(sourcePath)};
    ${makeControl}
    ${storage}
    ${exercise}
    export default { async fetch(request) {
      const { endpoint, origin } = await request.json();
      const nativeSocket = async () => {
        const response = await fetch(endpoint.replace('ws:', 'http:'), { headers: { Upgrade: 'websocket' } });
        if (!response.webSocket) throw new Error('Native websocket upgrade failed: ' + response.status);
        response.webSocket.accept();
        return response.webSocket;
      };
      let adapter;
      const sockets = [];
      const binding = { async fetch() {
        const socket = await nativeSocket();
        const pair = new WebSocketPair();
        pair[1].accept();
        sockets.push(socket, pair[1]);
        const upstream = { send(message) { socket.send(JSON.stringify(message)); }, close() { socket.close(); } };
        socket.addEventListener('message', event => upstream.onmessage?.(JSON.parse(event.data)));
        socket.addEventListener('close', () => upstream.onclose?.('Browser socket closed'));
        adapter = createPlaywrightPrivateTargetTransport(upstream);
        adapter.transport.onmessage = message => pair[1].send(JSON.stringify(message));
        adapter.transport.onclose = () => pair[1].close();
        pair[1].addEventListener('message', event => adapter.transport.send(JSON.parse(event.data)));
        pair[1].addEventListener('close', () => adapter.transport.close());
        return new Response(null, { status: 101, webSocket: pair[0] });
      }};
      const controlSocket = await nativeSocket();
      let browser;
      try {
        browser = await connect(binding, 'owned-native-fixture');
        return Response.json(await exercise(browser, makeControl(controlSocket), adapter, origin));
      } finally {
        await browser?.close();
        controlSocket.close();
        for (const socket of sockets) { try { socket.close(); } catch {} }
      }
    }};
  `;
  const bundle = await build({ stdin: { contents: worker, resolveDir: runtimeRoot, sourcefile: 'private-target-worker.mjs' }, nodePaths: [resolve(runtimeRoot, 'node_modules')],
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'] });
  await nativeHost(async ({ endpoint, origin, version }) => {
    const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-08',
      compatibilityFlags: ['nodejs_compat'], unsafeEvalBinding: 'EVAL', cf: false });
    try {
      const response = await miniflare.dispatchFetch('http://fixture/', { method: 'POST', body: JSON.stringify({ endpoint, origin }) });
      assert.equal(response.status, 200, (await response.clone().text()).slice(0, 2000));
      context.diagnostic(JSON.stringify({ version, versions, profile: 'local workerd nodejs_compat + EVAL; public BrowserWorker.fetch bridge; not managed deployment', result: await response.json() }));
    } finally { await miniflare.dispose(); }
  });
});
