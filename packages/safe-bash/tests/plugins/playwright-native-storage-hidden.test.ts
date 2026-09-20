import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const runtime = process.env.SAFE_BASH_STORAGE_RUNTIME;
const worker = `
import { acquire, connect, sessions } from '@cloudflare/playwright';
import { createPlaywrightPrivateTargetTransport } from '@storage/private-transport';
export default { async fetch(request, env) {
  const { origin } = await request.json();
  const { sessionId } = await acquire(env.BROWSER);
  const sockets = [];
  const nativeSocket = async () => {
    const response = await env.BROWSER.fetch('http://browser/v1/devtools/browser/' + sessionId, { headers: { Upgrade: 'websocket' } });
    if (!response.webSocket) throw new Error('Native control connection rejected: ' + response.status + ' ' + await response.text());
    response.webSocket.accept(); sockets.push(response.webSocket); return response.webSocket;
  };
  const control = await nativeSocket();
  const pending = new Map(); const destroyed = new Set(); const closing = new Map();
  let sequence = 0; let guard; let browser; let targetId; let retiredReply;
  control.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Target.targetDestroyed') { destroyed.add(message.params.targetId); closing.get(message.params.targetId)?.(); }
    const operation = pending.get(message.id);
    if (!operation) return;
    if (operation.method === 'Runtime.evaluate' && message.error) retiredReply = { method: operation.method, requestHasSession: !!operation.session, responseHasSession: !!message.sessionId, error: message.error };
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error))); else operation.resolve(message.result);
  });
  const send = (method, params = {}, session) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 5000);
    pending.set(id, { resolve, reject, timer, method, session });
    control.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
  const binding = { async fetch() {
    const socket = await nativeSocket();
    const pair = new WebSocketPair(); pair[1].accept(); sockets.push(pair[1]);
    const upstream = { send(message) { socket.send(JSON.stringify(message)); }, close() { socket.close(); } };
    socket.addEventListener('message', event => upstream.onmessage?.(JSON.parse(event.data)));
    socket.addEventListener('close', () => upstream.onclose?.('Native browser connection closed'));
    guard = createPlaywrightPrivateTargetTransport(upstream);
    guard.transport.onmessage = message => pair[1].send(JSON.stringify(message));
    guard.transport.onclose = () => pair[1].close();
    pair[1].addEventListener('message', event => guard.transport.send(JSON.parse(event.data)));
    pair[1].addEventListener('close', () => guard.transport.close());
    return new Response(null, { status: 101, webSocket: pair[0] });
  } };
  let report;
  try {
    browser = await connect(binding, sessionId);
    await send('Target.setDiscoverTargets', { discover: true });
    const context = await browser.newContext();
    const original = await context.newPage(); await original.goto(origin);
    await original.evaluate(() => globalThis.sessionStorage.setItem('owner', 'preserved'));
    const native = await context.newCDPSession(original);
    const { targetInfo: originalInfo } = await native.send('Target.getTargetInfo'); await native.detach();
    await context.addInitScript(() => { globalThis.earlyInit = true; globalThis.localStorage.setItem('init-witness', 'unexpected'); });
    const creation = guard.beginCreation();
    try { ({ targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: originalInfo.browserContextId, background: true })); creation.commit(targetId); }
    catch (error) { creation.fail(error); throw error; }
    const { sessionId: targetSession } = await send('Target.attachToTarget', { targetId, flatten: true });
    const { targetInfo } = await send('Target.getTargetInfo', {}, targetSession);
    if (targetInfo.targetId !== targetId || targetInfo.browserContextId !== originalInfo.browserContextId) throw new Error('Native ownership mismatch');
    await send('Emulation.setScriptExecutionDisabled', { value: true }, targetSession);
    await context.addInitScript(() => { globalThis.lateInit = true; });
    await send('Page.enable', {}, targetSession);
    await send('Page.navigate', { url: origin }, targetSession);
    let markers;
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await send('Runtime.evaluate', { expression: 'JSON.stringify({origin:location.origin,ready:document.readyState,early:typeof earlyInit,late:typeof lateInit,html:typeof documentInit})', returnByValue: true }, targetSession);
      markers = JSON.parse(value.result.value);
      if (markers.origin === origin && markers.ready === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const { frameTree } = await send('Page.getFrameTree', {}, targetSession);
    const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'owned-storage' }, targetSession);
    const written = await send('Runtime.evaluate', { expression: '(async () => { localStorage.setItem("restored", "yes"); const opening = indexedDB.open("hidden-db", 1); await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore("records"); opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); }); opening.result.close(); return {done:true}; })()', contextId: executionContextId, returnByValue: true, awaitPromise: true }, targetSession);
    if (written.exceptionDetails) throw new Error(JSON.stringify(written.exceptionDetails));
    const visible = await original.evaluate(async () => ({ owner: globalThis.sessionStorage.getItem('owner'), restored: globalThis.localStorage.getItem('restored'), initWitness: globalThis.localStorage.getItem('init-witness'), databases: (await globalThis.indexedDB.databases()).map(database => database.name) }));
    const hidden = context.pages().length === 1 && context.pages()[0] === original;
    await send('Target.detachFromTarget', { sessionId: targetSession });
    await send('Runtime.evaluate', { expression: '1', returnByValue: true }, targetSession).catch(() => {});
    const removed = new Promise(resolve => { if (destroyed.has(targetId)) resolve(); else closing.set(targetId, resolve); });
    const closed = await send('Target.closeTarget', { targetId }); await removed;
    const absent = !(await send('Target.getTargets')).targetInfos.some(info => info.targetId === targetId);
    const positive = await context.newPage(); await positive.goto(origin);
    const normalScripts = await positive.evaluate(() => ({ early: globalThis.earlyInit, late: globalThis.lateInit, html: globalThis.documentInit }));
    await positive.close(); await context.close();
    report = { markers, visible, hidden, absent, closed: closed.success, normalScripts, independentNativeIdentity: true, retiredReply };
  } finally {
    await browser?.close();
    for (const socket of sockets) { try { socket.close(); } catch {} }
    for (const operation of pending.values()) clearTimeout(operation.timer);
    const removed = await env.BROWSER.fetch('http://browser/v1/devtools/browser/' + sessionId, { method: 'DELETE' });
    if (!removed.ok) throw new Error('Browser retirement failed');
  }
  return Response.json({ ...report, sessionAbsent: !(await sessions(env.BROWSER)).some(entry => entry.sessionId === sessionId) });
} };`;

test('actual CF binding permits isolated context-bound native storage control', { skip: !runtime, timeout: 45_000 }, async context => {
  const out = process.env.SAFE_BASH_STORAGE_OUT;
  assert.ok(out);
  assert.ok(out?.startsWith('/home/') && process.env.TMPDIR?.startsWith('/home/'));
  const require = createRequire(resolve(runtime!, 'package.json'));
  assert.equal(require(resolve(runtime!, 'node_modules/@cloudflare/playwright/package.json')).version, '1.3.6');
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.documentInit = true</script>'); });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  context.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const { build } = require('esbuild');
  const bundle = await build({ stdin: { contents: worker, resolveDir: process.cwd() }, alias: { '@storage/private-transport': resolve('packages/safe-bash/src/playwright/private-target-transport.ts') }, nodePaths: [resolve(runtime!, 'node_modules')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'] });
  const { Miniflare } = require('miniflare');
  const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' } });
  await mkdir(out, { recursive: true }); const directory = await mkdtemp(join(out, 'hidden-'));
  try {
    await miniflare.ready;
    const response = await miniflare.dispatchFetch('http://fixture/hidden', { method: 'POST', body: JSON.stringify({ origin }) });
    const text = await response.text();
    await writeFile(join(directory, 'report.json'), JSON.stringify({ scope: 'Actual CF1.3.6 and Miniflare Browser Rendering binding, not deployed', status: response.status, body: text }, null, 2));
    context.diagnostic(directory);
    assert.equal(response.status, 200, text.slice(0, 2000));
    const report = JSON.parse(text);
    assert.deepEqual(report.retiredReply, { method: 'Runtime.evaluate', requestHasSession: true, responseHasSession: false, error: { code: -32001, message: 'Session with given id not found.' } });
    assert.deepEqual(report.markers, { origin, ready: 'complete', early: 'undefined', late: 'undefined', html: 'undefined' });
    assert.deepEqual(report.visible, { owner: 'preserved', restored: 'yes', initWitness: null, databases: ['hidden-db'] });
    assert.deepEqual(report.normalScripts, { early: true, late: true, html: true });
    for (const key of ['hidden', 'absent', 'closed', 'independentNativeIdentity', 'sessionAbsent']) assert.equal(report[key], true, key);
  } finally { await miniflare.dispose(); }
});
