import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { storageCloudflareHostSource } from './playwright-native-storage-cf-fixture.js';

const runtime = process.env.SAFE_BASH_STORAGE_RUNTIME;
const cloudflare = process.env.SAFE_BASH_STORAGE_CF === '1';
const driver = `
import { createPlaywrightCli } from '@storage/command';
import { createPlaywrightAdapter } from '@storage/adapter';
import { createMemoryFileSystem } from '@storage/filesystem';
import { readPlaywrightStorageState, replacePlaywrightStorageState } from '@storage/replacement';
export async function qualify(browser, origins, prepareStorageOrigin) {
  const fs = createMemoryFileSystem();
  const activeTargets = new Set(); let waitForRestore;
  const trackedPrepare = prepareStorageOrigin && (async request => {
    const lease = await prepareStorageOrigin(request); activeTargets.add(lease.targetId);
    return { ...lease, cdp: { ...lease.cdp, send(method, params) {
      if (method === 'Runtime.evaluate' && params.expression.includes('.deleteDatabase(')) waitForRestore?.();
      return lease.cdp.send(method, params);
    } }, async release() { await lease.release(); activeTargets.delete(lease.targetId); } };
  });
  const client = createPlaywrightCli({ adapter: createPlaywrightAdapter({ chromium: { async acquireBrowser() { return { browser, prepareStorageOrigin: trackedPrepare, async release() {} }; } } }) });
  let command;
  client.plugin.setup({ commands: { register(value) { command = value; } } });
  const run = async args => {
    let stdout = ''; let stderr = '';
    const cleanups = [];
    try {
      const result = await command.execute({ args, cwd: '/', env: {}, fs, signal: new AbortController().signal,
        registerCleanup: cleanup => cleanups.push(cleanup),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      return { stdout, stderr, exitCode: result.exitCode };
    } finally { for (const cleanup of cleanups) await cleanup(); }
  };
  try {
    const opened = await run(['open', origins[0]]);
    if (opened.exitCode) throw new Error(JSON.stringify(opened));
    const before = client.inspectSessions()[0];
    const context = before.context;
    const first = before.selectedPage;
    const second = await context.newPage();
    await second.goto(origins[0]);
    await first.evaluate(() => { globalThis.sessionStorage.setItem('tab', 'first'); globalThis.localStorage.setItem('old', 'remove'); });
    await second.evaluate(() => globalThis.sessionStorage.setItem('tab', 'second'));
    await context.addCookies([{ name: 'old-cookie', value: 'remove', url: origins[0] }]);
    const historical = await context.newPage();
    await historical.goto(origins[1]);
    await historical.evaluate(async () => {
      const opening = globalThis.indexedDB.open('closed-idb-only', 1);
      await new Promise((accept, reject) => {
        opening.onupgradeneeded = () => opening.result.createObjectStore('records');
        opening.onsuccess = accept; opening.onerror = () => reject(opening.error);
      });
      opening.result.close();
    });
    await historical.close();
    const serviceWorkerBefore = await first.evaluate(async () => {
      globalThis.helperNavigations = 0;
      navigator.serviceWorker.addEventListener('message', () => { globalThis.helperNavigations++; });
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      return (await fetch('/probe')).text();
    });
    const censusOptions = { signal: new AbortController().signal, maxBytes: 1048576, registerCleanup() {} };
    const censusBefore = await readPlaywrightStorageState(context, { ...censusOptions, indexedDB: true });
    // A direct provider census may retain a live database connection. Native
    // replacement must still clear it without changing the application's tabs.
    await context.storageState({ indexedDB: true });
    const censusBeforeWitness = await first.evaluate(() => globalThis.helperNavigations);
    const pages = context.pages();
    await context.addInitScript(() => { globalThis.localStorage.setItem('init-witness', 'unexpected'); });
    await fs.writeFile('/empty.json', new TextEncoder().encode('{"cookies":[],"origins":[]}'));
    const loaded = await run(['state-load', 'empty.json', '--json']);
    const loadWitness = await first.evaluate(() => globalThis.helperNavigations);
    const after = client.inspectSessions()[0];
    const currentPages = after.context.pages();
    const cleared = { loaded, censusBefore, censusAfter: await readPlaywrightStorageState(after.context, { ...censusOptions, indexedDB: true }),
      serviceWorkers: { before: serviceWorkerBefore, censusBeforeWitness, loadWitness, ...await first.evaluate(async () => ({ after: await (await fetch('/probe')).text(), registrations: (await navigator.serviceWorker.getRegistrations()).length, helperNavigations: globalThis.helperNavigations })) },
      sameContext: context === after.context, sameSelectedPage: first === after.selectedPage,
      samePages: currentPages.length === pages.length && currentPages.every((page, index) => page === pages[index]),
      sessionStorage: await Promise.all(currentPages.map(page => page.evaluate(() => globalThis.sessionStorage.getItem('tab')))),
      localStorage: await Promise.all(currentPages.map(page => page.evaluate(() => globalThis.localStorage.length))) };
    const donor = await browser.newContext();
    let importedState;
    try {
      const page = await donor.newPage(); await page.goto(origins[2]);
      await page.evaluate(async () => {
        globalThis.localStorage.setItem('imported', 'yes');
        const opening = indexedDB.open('imported-db', 2);
        await new Promise((resolve, reject) => { opening.onupgradeneeded = () => { opening.result.createObjectStore('records'); }; opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
        const database = opening.result;
        const transaction = database.transaction('records', 'readwrite');
        const completed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
        const value = { nil: null, missing: undefined, number: 42n, bytes: new Uint8Array([0, 128, 255]), date: new Date('2026-01-01T00:00:00Z') }; value.self = value;
        transaction.objectStore('records').add(value, 'encoded');
        transaction.objectStore('records').add(null, 'null');
        await completed; database.close();
      });
      await donor.addCookies([{ name: 'imported', value: 'yes', url: origins[2] }]);
      importedState = await donor.storageState({ indexedDB: true });
      importedState.origins[0].indexedDB[0].stores[0].records.find(record => record.key === 'null').valueEncoded = { v: 'null' };
      importedState.origins[0].indexedDB[0].stores[0].records.push({ key: 'native-null', value: null });
    } finally { await donor.close(); }
    await fs.writeFile('/imported.json', new TextEncoder().encode(JSON.stringify(importedState)));
    const importedLoad = await run(['state-load', 'imported.json', '--json']);
    if (importedLoad.exitCode) throw new Error('importedLoad: ' + JSON.stringify(importedLoad));
    const mutate = async () => { globalThis.localStorage.setItem('imported', 'mutated'); globalThis.localStorage.setItem('intervening', 'current'); };
    if (prepareStorageOrigin) {
      const native = await context.newCDPSession(first);
      const { targetInfo } = await native.send('Target.getTargetInfo'); await native.detach();
      const lease = await prepareStorageOrigin({ context, browserContextId: targetInfo.browserContextId, origin: origins[2], signal: new AbortController().signal });
      try {
        const { frameTree } = await lease.cdp.send('Page.getFrameTree');
        const { executionContextId } = await lease.cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'native-mutation-control' });
        const result = await lease.cdp.send('Runtime.evaluate', { expression: '(' + mutate.toString() + ')()', contextId: executionContextId, awaitPromise: true });
        if (result.exceptionDetails) throw new Error('Native mutation control failed');
      } finally { await lease.cdp.detach(); await lease.release(); }
    } else {
      const mutationPage = await context.newPage();
      try { await mutationPage.goto(origins[2]); await mutationPage.evaluate(() => globalThis.localStorage.removeItem('init-witness')); await mutationPage.evaluate(mutate); }
      finally { await mutationPage.close(); }
    }
    const saved = await run(['state-save', 'saved.json', '--json']);
    if (saved.exitCode) throw new Error('saved: ' + JSON.stringify(saved));
    const savedState = JSON.parse(new TextDecoder().decode(await fs.readFile('/saved.json')));
    const readCleanups = [];
    let indexedState;
    try { indexedState = await readPlaywrightStorageState(context, { indexedDB: true, maxBytes: 1048576, signal: new AbortController().signal, registerCleanup: cleanup => readCleanups.push(cleanup) }); }
    finally { for (const cleanup of readCleanups) await cleanup(); }
    const clearedImport = await run(['state-load', 'empty.json', '--json']);
    if (clearedImport.exitCode) throw new Error('clearedImport: ' + JSON.stringify(clearedImport));
    const untouched = context.pages().length === 2 && context.pages().every((page, index) => page === pages[index]);
    const inspector = await context.newPage(); await inspector.goto(origins[2]);
    const removedImported = await inspector.evaluate(async () => ({ local: globalThis.localStorage.getItem('imported'), databases: (await indexedDB.databases()).map(item => item.name) }));
    const importedAgain = await run(['state-load', 'imported.json', '--json']);
    if (importedAgain.exitCode) throw new Error('importedAgain: ' + JSON.stringify(importedAgain));
    const restored = await inspector.evaluate(async () => {
      const opening = indexedDB.open('imported-db');
      await new Promise((resolve, reject) => { opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
      const database = opening.result;
      try {
        const transaction = database.transaction('records');
        const read = key => new Promise((resolve, reject) => { const request = transaction.objectStore('records').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const [value, nil, nativeNull] = await Promise.all([read('encoded'), read('null'), read('native-null')]);
        return { local: globalThis.localStorage.getItem('imported'), nil: nil === null, nativeNull: nativeNull === undefined, cyclic: value.self === value, missing: Object.hasOwn(value, 'missing') && value.missing === undefined, bytes: [...value.bytes], number: String(value.number), date: value.date.toISOString() };
      } finally { database.close(); }
    });
    await inspector.close();
    let cancellation;
    if (trackedPrepare) {
      await first.evaluate(async () => {
        const opening = indexedDB.open('locked-db', 1);
        await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore('records'); opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
        globalThis.lockedDatabase = opening.result;
      });
      const controller = new AbortController(); const cleanups = [];
      const started = new Promise(resolve => { waitForRestore = resolve; });
      const operation = replacePlaywrightStorageState(context, { cookies: [], origins: [] }, { signal: controller.signal, maxBytes: 1048576, registerCleanup: cleanup => cleanups.push(cleanup) });
      const settled = operation.then(() => ({ error: null }), error => ({ error: String(error) }));
      await started;
      controller.abort(new Error('cancelled native pending storage'));
      cancellation = { ...(await settled), activeTargets: activeTargets.size };
      for (const cleanup of cleanups) await cleanup();
      await first.evaluate(() => { globalThis.lockedDatabase.close(); delete globalThis.lockedDatabase; });
      waitForRestore = undefined;
    }
    return { ...cleared, imported: { importedLoad, saved, savedState, indexedState, importedState, clearedImport, untouched, removedImported, importedAgain, restored }, cancellation, activeTargets: activeTargets.size, finalSessions: await Promise.all(pages.map(page => page.evaluate(() => globalThis.sessionStorage.getItem('tab')))) };
  } finally { await client.dispose(); }
}
`;

test(`state replacement preserves owned native tabs and sessionStorage: ${cloudflare ? 'Cloudflare/local workerd' : 'Chromium'}`, { skip: !runtime, timeout: 60_000 }, async context => {
  const out = process.env.SAFE_BASH_STORAGE_OUT;
  assert.ok(out);
  const executablePath = process.env.SAFE_BASH_STORAGE_CHROMIUM;
  assert.ok(out?.startsWith('/home/') && executablePath && process.env.TMPDIR?.startsWith('/home/'));
  const require = createRequire(resolve(runtime!, 'package.json'));
  const origins = await Promise.all(['active', 'historical', 'imported'].map(async () => {
    const server = createServer((request, response) => {
      if (request.url === '/sw.js') {
        response.setHeader('content-type', 'text/javascript');
        response.end('self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));self.addEventListener("fetch",event=>{if(new URL(event.request.url).pathname==="/probe")event.respondWith(new Response("normal-native-service-worker"));else if(event.request.mode==="navigate")event.waitUntil(self.clients.matchAll().then(clients=>Promise.all(clients.map(client=>client.postMessage("helper-navigation")))));});');
        return;
      }
      response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Storage qualification</title>');
    });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    context.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }));
  await mkdir(out, { recursive: true });
  const directory = await mkdtemp(join(out, 'preservation-'));
  const { build } = require('esbuild');
  const alias = { '@storage/replacement': resolve('packages/safe-bash/src/playwright/native-storage-replacement.ts'), '@storage/private-transport': resolve('packages/safe-bash/src/playwright/private-target-transport.ts'), '@storage/targets': resolve('packages/safe-bash/src/playwright/native-storage-targets.ts'), '@storage/command': resolve('packages/safe-bash/src/commands/playwright/index.ts'), '@storage/adapter': resolve('packages/safe-bash/src/playwright/adapter.ts'), '@storage/filesystem': resolve('packages/safe-fs/src/core.ts'), '@poe-code/safe-fs/core': resolve('packages/safe-fs/src/core.ts') };
  let report;
  if (cloudflare) {
    assert.equal(require(resolve(runtime!, 'node_modules/@cloudflare/playwright/package.json')).version, '1.3.6');
    const worker = driver + storageCloudflareHostSource + `
export default { async fetch(request, env) {
  const { origins } = await request.json();
  const resource = await acquireStorageBrowser(env.BROWSER);
  let report; let sessionAbsent;
  try { report = await qualify(resource.browser, origins, resource.prepareStorageOrigin); }
  finally { sessionAbsent = await resource.release(); }
  return Response.json({ ...report, sessionAbsent });
} };`;
    const bundle = await build({ stdin: { contents: worker, resolveDir: process.cwd() }, alias, nodePaths: [resolve(runtime!, 'node_modules')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'] });
    const { Miniflare } = require('miniflare');
    const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' } });
    try {
      await miniflare.ready;
      const response = await miniflare.dispatchFetch('http://fixture/storage', { method: 'POST', body: JSON.stringify({ origins }) });
      assert.equal(response.status, 200, (await response.clone().text()).slice(0, 2000));
      report = await response.json();
    } finally { await miniflare.dispose(); }
  } else {
    const bundle = await build({ stdin: { contents: driver, resolveDir: process.cwd() }, alias, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
    const path = join(directory, 'driver.mjs');
    await writeFile(path, bundle.outputFiles[0].text);
    const { qualify } = await import(pathToFileURL(path).href);
    const browser = await require('playwright').chromium.launch({ executablePath, headless: true });
    try { report = await qualify(browser, origins); }
    finally { await browser.close(); }
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify({ scope: cloudflare ? 'Actual CF1.3.6 local workerd, not deployed' : 'Actual native Chromium', report }, null, 2));
  context.diagnostic(directory);
  assert.ok(report.censusBefore.origins.some((origin: { indexedDB?: { name: string }[] }) => origin.indexedDB?.some(database => database.name === 'closed-idb-only')));
  assert.equal(report.loaded.exitCode, 0, JSON.stringify(report.loaded));
  assert.equal(report.sameContext, true, 'state-load must retain the native context');
  assert.equal(report.samePages, true, 'state-load must retain the native tabs');
  assert.equal(report.sameSelectedPage, true);
  assert.deepEqual(report.sessionStorage, ['first', 'second']);
  assert.deepEqual(report.localStorage, [0, 0]);
  assert.deepEqual(report.censusAfter, { cookies: [], origins: [] });
  assert.deepEqual(report.serviceWorkers, { before: 'normal-native-service-worker', after: 'normal-native-service-worker', registrations: 0, helperNavigations: 1, censusBeforeWitness: 0, loadWitness: 1 });
  for (const key of ['importedLoad', 'saved', 'clearedImport', 'importedAgain']) assert.equal(report.imported[key].exitCode, 0, JSON.stringify(report.imported[key]));
  report.imported.savedState.origins[0].localStorage.sort((left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name));
  assert.deepEqual(report.imported.savedState, { cookies: report.imported.importedState.cookies, origins: [{ origin: origins[2], localStorage: [{ name: 'imported', value: 'mutated' }, { name: 'intervening', value: 'current' }] }] });
  assert.equal(report.imported.indexedState.origins[0].indexedDB[0].name, 'imported-db');
  assert.equal(report.imported.indexedState.origins[0].indexedDB[0].stores[0].records.length, 3);
  assert.equal(report.imported.untouched, true);
  assert.deepEqual(report.imported.removedImported, { local: null, databases: [] });
  assert.deepEqual(report.imported.restored, { local: 'yes', nil: true, nativeNull: true, cyclic: true, missing: true, bytes: [0, 128, 255], number: '42', date: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(report.finalSessions, ['first', 'second']);
  if (cloudflare) {
    assert.equal(report.sessionAbsent, true);
    assert.equal(report.activeTargets, 0);
    assert.deepEqual(report.cancellation, { error: 'Error: cancelled native pending storage', activeTargets: 0 });
  }
});
