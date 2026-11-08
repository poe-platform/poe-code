export const installedStorageDriver = `
import { createPlaywrightCli, createPlaywrightAdapter } from '@poe-platform/safe-bash/commands/playwright';
import { createMemoryFileSystem } from '@poe-platform/safe-fs/core';
export async function qualifyInstalledStorage(browser, origins, prepareStorageOrigin, retireBrowser) {
  const fs = createMemoryFileSystem();
  const live = new Set(); let waiting; let releases = 0;
  const prepare = prepareStorageOrigin && (async request => {
    const lease = await prepareStorageOrigin(request); live.add(lease.targetId);
    return { ...lease, cdp: { ...lease.cdp, send(method, params) {
      if (method === 'Runtime.evaluate' && params.expression.includes('.deleteDatabase(')) waiting?.();
      return lease.cdp.send(method, params);
    } }, async release() { await lease.release(); live.delete(lease.targetId); } };
  });
  const client = createPlaywrightCli({ adapter: createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    return { browser, prepareStorageOrigin: prepare, async release() { releases++; await retireBrowser(); } };
  } } }) });
  let command;
  client.plugin.setup({ commands: { register(value) { command = value; } } });
  const run = async (args, signal = new AbortController().signal) => {
    let stdout = ''; let stderr = ''; const cleanups = [];
    try {
      const result = await command.execute({ args, cwd: '/', env: {}, fs, signal, registerCleanup: cleanup => cleanups.push(cleanup),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      return { stdout, stderr, exitCode: result.exitCode };
    } finally { for (const cleanup of cleanups) await cleanup(); }
  };
  const successful = async args => { const result = await run(args); if (result.exitCode !== 0) throw new Error(JSON.stringify({ args, result })); return result; };
  try {
    await successful(['open', origins[0]]);
    const original = client.inspectSessions()[0]; const context = original.context; const first = original.selectedPage;
    const second = await context.newPage(); await second.goto(origins[0]);
    await first.evaluate(() => { sessionStorage.setItem('tab', 'first'); localStorage.setItem('old', 'remove'); });
    await second.evaluate(() => sessionStorage.setItem('tab', 'second'));
    await context.addCookies([{ name: 'old', value: 'remove', url: origins[0] }]);
    const historical = await context.newPage(); await historical.goto(origins[1]);
    await historical.evaluate(async () => {
      const opening = indexedDB.open('closed-idb-only', 1);
      await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore('records'); opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
      opening.result.close();
    });
    await historical.close();
    const before = await context.storageState({ indexedDB: true });
    await context.addInitScript(() => localStorage.setItem('init-witness', 'unexpected'));
    await fs.writeFile('/empty.json', new TextEncoder().encode('{"cookies":[],"origins":[]}'));
    await successful(['state-load', 'empty.json', '--json']);
    const after = client.inspectSessions()[0];
    const pages = context.pages();
    const baseline = { historical: before.origins.some(origin => origin.indexedDB?.some(database => database.name === 'closed-idb-only')),
      sameContext: after.context === context, sameSelectedPage: after.selectedPage === first,
      sameTabs: pages.length === 2 && pages[0] === first && pages[1] === second,
      sessions: await Promise.all(pages.map(page => page.evaluate(() => sessionStorage.getItem('tab')))),
      state: await context.storageState({ indexedDB: true }) };
    const donor = await browser.newContext(); let imported;
    try {
      const page = await donor.newPage(); await page.goto(origins[2]);
      await page.evaluate(async () => {
        localStorage.setItem('imported', 'yes');
        const opening = indexedDB.open('imported-db', 2);
        await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore('records'); opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
        const database = opening.result; const transaction = database.transaction('records', 'readwrite');
        const completed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
        const value = { nil: null, missing: undefined, number: 42n, bytes: new Uint8Array([0, 128, 255]), date: new Date('2026-01-01T00:00:00Z') }; value.self = value;
        transaction.objectStore('records').add(value, 'encoded'); await completed; database.close();
      });
      await donor.addCookies([{ name: 'imported', value: 'yes', url: origins[2] }]);
      imported = await donor.storageState({ indexedDB: true });
      imported.origins[0].indexedDB[0].stores[0].records.push({ key: 'null', valueEncoded: { v: 'null' } }, { key: 'native-null', value: null });
    } finally { await donor.close(); }
    await fs.writeFile('/imported.json', new TextEncoder().encode(JSON.stringify(imported)));
    await successful(['state-load', 'imported.json', '--json']);
    const mutate = () => { localStorage.removeItem('init-witness'); localStorage.setItem('imported', 'mutated'); localStorage.setItem('intervening', 'current'); };
    if (prepareStorageOrigin) {
      const native = await context.newCDPSession(first); const { targetInfo } = await native.send('Target.getTargetInfo'); await native.detach();
      const lease = await prepareStorageOrigin({ context, browserContextId: targetInfo.browserContextId, origin: origins[2], signal: new AbortController().signal });
      try {
        const { frameTree } = await lease.cdp.send('Page.getFrameTree');
        const { executionContextId } = await lease.cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'installed-mutation-control' });
        const result = await lease.cdp.send('Runtime.evaluate', { expression: '(' + mutate.toString() + ')()', contextId: executionContextId, awaitPromise: true });
        if (result.exceptionDetails) throw new Error('Native mutation failed');
      } finally { await lease.cdp.detach(); await lease.release(); }
    } else {
      const mutationPage = await context.newPage();
      try { await mutationPage.goto(origins[2]); await mutationPage.evaluate(mutate); } finally { await mutationPage.close(); }
    }
    const save = await successful(['state-save', 'saved.json', '--json']);
    const saved = JSON.parse(new TextDecoder().decode(await fs.readFile('/saved.json')));
    await successful(['state-load', 'empty.json', '--raw']);
    const preserved = context.pages().length === 2 && context.pages().every((page, index) => page === pages[index]);
    const inspector = await context.newPage(); await inspector.goto(origins[2]);
    const removed = await inspector.evaluate(async () => ({ local: localStorage.getItem('imported'), databases: (await indexedDB.databases()).map(database => database.name) }));
    await successful(['state-load', 'imported.json', '--json']);
    const restored = await inspector.evaluate(async () => {
      const opening = indexedDB.open('imported-db'); await new Promise((resolve, reject) => { opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
      const database = opening.result;
      try {
        const transaction = database.transaction('records');
        const read = key => new Promise((resolve, reject) => { const request = transaction.objectStore('records').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const [value, nil, nativeNull] = await Promise.all([read('encoded'), read('null'), read('native-null')]);
        return { local: localStorage.getItem('imported'), nil: nil === null, nativeNull: nativeNull === undefined, cyclic: value.self === value, missing: Object.hasOwn(value, 'missing') && value.missing === undefined,
          bytes: [...value.bytes], number: String(value.number), date: value.date.toISOString() };
      } finally { database.close(); }
    });
    const indexed = await context.storageState({ indexedDB: true });
    await inspector.close();
    const finalSessions = await Promise.all(pages.map(page => page.evaluate(() => sessionStorage.getItem('tab'))));
    let cancellation;
    if (prepare) {
      await first.evaluate(async () => {
        const opening = indexedDB.open('locked-db', 1);
        await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore('records'); opening.onsuccess = resolve; opening.onerror = () => reject(opening.error); });
        globalThis.lockedDatabase = opening.result;
      });
      const controller = new AbortController(); const started = new Promise(resolve => { waiting = resolve; });
      const operation = run(['state-load', 'empty.json', '--json'], controller.signal).then(result => ({ result }), error => ({ error: String(error) }));
      await started; controller.abort(new Error('installed-public-storage-cancel'));
      cancellation = { ...(await operation), activeTargets: live.size, releases, browserConnected: browser.isConnected() };
    }
    return { baseline, importedCookies: imported.cookies, saved, save, preserved, removed, restored, indexed, finalSessions, cancellation, activeTargets: live.size };
  } finally { await client.dispose(); }
}
`;

export const installedStorageCloudflareHost = `
import { acquire, connect, sessions } from '@cloudflare/playwright';
import { createPlaywrightPrivateTargetTransport, createPlaywrightStorageOriginPreparer } from '@poe-platform/safe-bash/commands/playwright';
async function acquireInstalledStorageBrowser(binding) {
  const { sessionId } = await acquire(binding); const sockets = []; let retirement;
  const nativeSocket = async () => {
    const response = await binding.fetch('http://browser/v1/devtools/browser/' + sessionId, { headers: { Upgrade: 'websocket' } });
    if (!response.webSocket) throw new Error('Native control connection rejected');
    response.webSocket.accept(); sockets.push(response.webSocket); return response.webSocket;
  };
  const socket = await nativeSocket(); const pending = new Map(); const listeners = new Set(); let sequence = 0; let guard;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) for (const listener of listeners) listener(message);
    if (message.method === 'Target.detachedFromTarget') for (const [id, operation] of pending) {
      if (operation.session !== message.params.sessionId) continue;
      pending.delete(id); clearTimeout(operation.timer); operation.reject(new Error('Native control target detached'));
    }
    const operation = pending.get(message.id); if (!operation) return;
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error))); else operation.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Native control closed')); } pending.clear(); });
  const control = { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, send(method, params = {}, session) {
    return new Promise((resolve, reject) => { const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000);
      pending.set(id, { resolve, reject, timer, session }); socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  } };
  const guardedBinding = { async fetch() {
    const native = await nativeSocket(); const pair = new WebSocketPair(); pair[1].accept(); sockets.push(pair[1]);
    const upstream = { send(message) { native.send(JSON.stringify(message)); }, close() { native.close(); } };
    native.addEventListener('message', event => upstream.onmessage?.(JSON.parse(event.data)));
    native.addEventListener('close', () => upstream.onclose?.('Native connection closed'));
    guard = createPlaywrightPrivateTargetTransport(upstream);
    guard.transport.onmessage = message => pair[1].send(JSON.stringify(message)); guard.transport.onclose = () => pair[1].close();
    pair[1].addEventListener('message', event => guard.transport.send(JSON.parse(event.data))); pair[1].addEventListener('close', () => guard.transport.close());
    return new Response(null, { status: 101, webSocket: pair[0] });
  } };
  const browser = await connect(guardedBinding, sessionId);
  return { browser, prepareStorageOrigin: createPlaywrightStorageOriginPreparer(control, guard), release() {
    return retirement ??= (async () => { await browser.close(); for (const current of sockets) { try { current.close(); } catch {} }
      for (const operation of pending.values()) clearTimeout(operation.timer);
      const response = await binding.fetch('http://browser/v1/devtools/browser/' + sessionId, { method: 'DELETE' }); if (!response.ok) throw new Error('Browser retirement failed');
      return !(await sessions(binding)).some(session => session.sessionId === sessionId);
    })();
  } };
}
`;
