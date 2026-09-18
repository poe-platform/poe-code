import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { PlaywrightContext, PlaywrightPage, PlaywrightStorageState } from '../../src/playwright/adapter.js';
import { bindPlaywrightStorageContext, readPlaywrightStorageState, replacePlaywrightStorageState, type PlaywrightStorageOriginLease } from '../../src/playwright/native-storage-replacement.js';

const empty: PlaywrightStorageState = { cookies: [], origins: [] };
const origin = 'https://storage.example';

function fixture() {
  const events: string[] = [];
  let census: PlaywrightStorageState = { cookies: [], origins: [{ origin, localStorage: [] }] };
  let readback = { origin, localStorage: [{ name: 'current', value: 'mutated' }], indexedDB: [{ name: 'current-db', version: 1, stores: [] }] };
  let preparedOrigin = origin;
  const listeners = new Set<(page: PlaywrightPage) => void>();
  const pages: PlaywrightPage[] = [];
  const page = { close: async () => { events.push('page.close'); } } as unknown as PlaywrightPage;
  const context = {
    pages: () => pages, newPage: async () => { events.push('page'); return page; },
    on: (_event: string, listener: (page: PlaywrightPage) => void) => { listeners.add(listener); },
    off: (_event: string, listener: (page: PlaywrightPage) => void) => { listeners.delete(listener); },
    newCDPSession: async () => ({ async send() { events.push('identity'); return { targetInfo: { targetId: 'public', browserContextId: 'owned' } }; }, async detach() { events.push('identity.detach'); } }),
    storageState: async () => { events.push('census'); return census; },
    clearCookies: async () => { events.push('cookies.clear'); }, addCookies: async () => { events.push('cookies.add'); },
  } as unknown as PlaywrightContext;
  const lease: PlaywrightStorageOriginLease = {
    browserContextId: 'owned', targetId: 'hidden',
    cdp: { async send(method, params) {
      events.push(method);
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'hidden', browserContextId: 'owned', url: preparedOrigin + '/' } };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame', url: preparedOrigin + '/' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate' && String(params?.expression).includes('Native storage read limit')) return { result: { value: JSON.stringify(String(params?.expression).includes('"indexedDB":true') ? { ...readback, origin: preparedOrigin } : { origin: preparedOrigin, localStorage: readback.localStorage }) } };
      return { result: { value: true } };
    }, async detach() { events.push('detach'); } },
    async release() { events.push('release'); },
  };
  const prepare = async (request?: { origin: string }) => { preparedOrigin = request?.origin ?? origin; events.push('prepare'); return lease; };
  const controller = new AbortController();
  const cleanups: (() => Promise<void>)[] = [];
  const options = { signal: controller.signal, maxBytes: 1048576, registerCleanup: (cleanup: () => Promise<void>) => { events.push('register'); cleanups.push(cleanup); } };
  return { context, events, lease, prepare, controller, cleanups, options, listeners, pages, setCensus: (value: PlaywrightStorageState) => { census = value; }, setReadback: (value: typeof readback) => { readback = value; } };
}

test('bound IndexedDB census uses the owned closing reader instead of the provider collector', async () => {
  const item = fixture();
  const nativeCensus = item.context.storageState!;
  item.context.storageState = async options => {
    assert.notEqual(options?.indexedDB, true, 'native provider census leaks live-page database connections');
    return nativeCensus();
  };
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  try {
    const state = await readPlaywrightStorageState(item.context, { ...item.options, indexedDB: true });
    assert.equal(state.origins[0]!.indexedDB![0]!.name, 'current-db');
    await replacePlaywrightStorageState(item.context, empty, item.options);
    assert.ok(item.events.includes('cookies.clear'));
  } finally { await retire(); }
});

test('closed historical and frame-only IndexedDB origins remain discoverable and listeners retire', async () => {
  const item = fixture(); item.setCensus(empty);
  const pageListeners = new Map<string, () => void>();
  let url = 'about:blank';
  const historical = { url: () => url, frames: () => [{ url: () => 'https://frame.example/path' }],
    on: (event: string, listener: () => void) => { pageListeners.set(event, listener); },
    off: (event: string) => { pageListeners.delete(event); },
  } as unknown as PlaywrightPage;
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  for (const listener of item.listeners) listener(historical);
  url = 'https://historical.example/path';
  pageListeners.get('framenavigated')?.();
  pageListeners.get('close')?.();
  const state = await readPlaywrightStorageState(item.context, { ...item.options, indexedDB: true });
  assert.deepEqual(state.origins.map(item => item.origin).sort(), ['https://frame.example', 'https://historical.example']);
  assert.ok(state.origins.every(item => item.indexedDB?.[0]?.name === 'current-db'));
  await retire();
  assert.equal(item.listeners.size, 0);
  assert.equal(pageListeners.size, 0);
});

test('initially supplied IndexedDB-only origins are included without live tabs', async () => {
  const item = fixture(); item.setCensus(empty);
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal, ['https://initial.example']);
  try {
    const state = await readPlaywrightStorageState(item.context, { ...item.options, indexedDB: true });
    assert.equal(state.origins[0]!.origin, 'https://initial.example');
    assert.equal(state.origins[0]!.indexedDB![0]!.name, 'current-db');
  } finally { await retire(); }
});

test('restoration clears IndexedDB through the verified native target before restoring records', async () => {
  const item = fixture();
  const send = item.lease.cdp.send;
  let cleared = false;
  item.lease.cdp.send = async (method, params) => {
    if (method === 'Storage.clearDataForOrigin') {
      assert.deepEqual(params, { origin, storageTypes: 'indexeddb' });
      cleared = true;
    }
    if (method === 'Runtime.evaluate' && String(params?.expression).includes('.deleteDatabase(') && !cleared) {
      return { exceptionDetails: { exception: { description: 'Database deletion blocked by an existing native census or live application connection' } } };
    }
    return send(method, params);
  };
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  try {
    await replacePlaywrightStorageState(item.context, empty, item.options);
    assert.equal(cleared, true);
    assert.ok(item.events.lastIndexOf('Target.getTargetInfo') < item.events.indexOf('Storage.clearDataForOrigin'));
    assert.ok(item.events.indexOf('Storage.clearDataForOrigin') < item.events.lastIndexOf('Runtime.evaluate'));
  } finally { await retire(); }
});

test('a database request blocked by a later competing connection rejects before a later request error', async () => {
  const item = fixture();
  const send = item.lease.cdp.send;
  item.lease.cdp.send = async (method, params) => {
    if (method !== 'Runtime.evaluate' || !String(params?.expression).includes('.deleteDatabase(')) return send(method, params);
    const request: { onblocked?: () => void; onerror?: () => void; error?: Error } = {};
    try {
      const value = await runInNewContext(String(params?.expression), { location: { origin }, navigator: {},
        indexedDB: { databases: async () => [{ name: 'locked' }], deleteDatabase() {
          queueMicrotask(() => { request.onblocked?.(); queueMicrotask(() => { request.error = new Error('later fallback request error'); request.onerror?.(); }); });
          return request;
        } }, localStorage: { clear() {} },
      });
      return { result: { value } };
    } catch (error) { return { exceptionDetails: { exception: { description: String(error) } } }; }
  };
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  try { await assert.rejects(replacePlaywrightStorageState(item.context, empty, item.options), /blocked.*open connection/i); }
  finally { await retire(); }
});

test('native identity is captured before exposure; replacement enumerates before destructive work and joins cleanup', async () => {
  const item = fixture();
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  assert.deepEqual(item.events, ['page', 'identity', 'identity.detach', 'page.close']);
  await replacePlaywrightStorageState(item.context, empty, item.options);
  assert.ok(item.events.indexOf('register') < item.events.indexOf('census'));
  assert.ok(item.events.indexOf('census') < item.events.indexOf('cookies.clear'));
  assert.ok(item.events.includes('Runtime.evaluate'));
  assert.deepEqual(item.events.slice(-2), ['detach', 'release']);
  await Promise.all(item.cleanups.map(cleanup => cleanup()));
  await retire();
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, item.options), /control/);
});

test('invalid or oversized full historical census has no destructive effects', async () => {
  const item = fixture();
  await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  item.setCensus({ cookies: [], origins: [{ origin, localStorage: [{ name: 'oversize', value: 'x'.repeat(2048) }] }] });
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, { ...item.options, maxBytes: 128 }), /limit/);
  assert.ok(!item.events.includes('cookies.clear'));
  assert.ok(!item.events.includes('prepare'));
});

test('a foreign native target is rejected and detached/released without evaluation', async () => {
  const item = fixture();
  await bindPlaywrightStorageContext(item.context, async () => ({ ...item.lease, targetId: 'foreign' }), item.controller.signal);
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, item.options), /identity/);
  assert.ok(!item.events.includes('Runtime.evaluate'));
  assert.ok(!item.events.includes('Storage.clearDataForOrigin'));
  assert.deepEqual(item.events.slice(-2), ['detach', 'release']);
});

test('late origin acquisition after cancellation is retired before settling', async () => {
  const item = fixture();
  let acquire!: (lease: PlaywrightStorageOriginLease) => void;
  let started!: () => void;
  const acquiring = new Promise<void>(resolve => { started = resolve; });
  await bindPlaywrightStorageContext(item.context, () => { started(); return new Promise(resolve => { acquire = resolve; }); }, item.controller.signal);
  const pending = replacePlaywrightStorageState(item.context, empty, item.options);
  await acquiring;
  item.controller.abort(new Error('cancelled'));
  acquire(item.lease);
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(item.events.slice(-2), ['detach', 'release']);
  assert.ok(!item.events.includes('Runtime.evaluate'));
});

test('no trusted acquired control fails explicitly without context reset', async () => {
  const item = fixture();
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, item.options), /control/);
  assert.deepEqual(item.events, []);
});

test('imported-only origin reads current native data, includes IDB only on request, and is forgotten after replacement/disposal', async () => {
  const item = fixture(); item.setCensus(empty);
  const retire = await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  await replacePlaywrightStorageState(item.context, { cookies: [], origins: [{ origin, localStorage: [{ name: 'cached', value: 'must-not-return' }] }] }, item.options);
  const current = await readPlaywrightStorageState(item.context, item.options);
  assert.deepEqual(current, { cookies: [], origins: [{ origin, localStorage: [{ name: 'current', value: 'mutated' }] }] });
  const indexed = await readPlaywrightStorageState(item.context, { ...item.options, indexedDB: true });
  assert.equal(indexed.origins[0]!.indexedDB![0]!.name, 'current-db');
  await replacePlaywrightStorageState(item.context, empty, item.options);
  const preparations = item.events.filter(event => event === 'prepare').length;
  assert.deepEqual(await readPlaywrightStorageState(item.context, item.options), empty);
  assert.equal(item.events.filter(event => event === 'prepare').length, preparations);
  await retire();
  assert.deepEqual(await readPlaywrightStorageState(item.context, item.options), empty);
  assert.equal(item.events.filter(event => event === 'prepare').length, preparations);
});

test('context-owned tracking does not leak to another native context', async () => {
  const first = fixture(); const second = fixture(); first.setCensus(empty); second.setCensus(empty);
  await bindPlaywrightStorageContext(first.context, first.prepare, first.controller.signal);
  await bindPlaywrightStorageContext(second.context, second.prepare, second.controller.signal);
  await replacePlaywrightStorageState(first.context, { cookies: [], origins: [{ origin, localStorage: [{ name: 'secret', value: 'owned' }] }] }, first.options);
  assert.deepEqual(await readPlaywrightStorageState(second.context, second.options), empty);
  assert.ok(!second.events.includes('prepare'));
});

test('oversized current imported data rejects before replacement side effects', async () => {
  const item = fixture(); item.setCensus(empty);
  await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  await replacePlaywrightStorageState(item.context, { cookies: [], origins: [{ origin, localStorage: [] }] }, item.options);
  item.setReadback({ origin, localStorage: [{ name: 'large', value: 'x'.repeat(10000) }], indexedDB: [] });
  const clears = item.events.filter(event => event === 'cookies.clear').length;
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, { ...item.options, maxBytes: 1000 }), /limit/);
  assert.equal(item.events.filter(event => event === 'cookies.clear').length, clears);
});

test('cancellation interrupts pending native evaluation and drains target retirement', async () => {
  const item = fixture();
  let evaluated!: () => void; let rejectEvaluation!: (error: Error) => void;
  const started = new Promise<void>(resolve => { evaluated = resolve; });
  const original = item.lease.cdp.send;
  item.lease.cdp.send = async (method, params) => {
    if (method !== 'Runtime.evaluate') return original(method, params);
    evaluated(); return new Promise((_, reject) => { rejectEvaluation = reject; });
  };
  item.lease.release = async () => { item.events.push('release'); rejectEvaluation(new Error('Native target closed')); };
  await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  const operation = replacePlaywrightStorageState(item.context, empty, item.options);
  await started;
  item.controller.abort(new Error('cancelled pending evaluation'));
  await assert.rejects(operation, /cancelled pending evaluation/);
  await Promise.all(item.cleanups.map(cleanup => cleanup()));
  assert.equal(item.events.filter(event => event === 'release').length, 1);
  assert.ok(item.events.includes('detach'));
});

test('detach failure cannot skip release, and execution plus cleanup errors stay observable', async () => {
  const item = fixture();
  item.lease.cdp.detach = async () => { throw new Error('detach failure'); };
  await bindPlaywrightStorageContext(item.context, async () => ({ ...item.lease, targetId: 'foreign' }), item.controller.signal);
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, item.options), error => error instanceof AggregateError && error.errors.some(value => String(value).includes('identity')) && error.errors.some(value => String(value).includes('detach failure')));
  assert.ok(item.events.includes('release'));
});

test('aggregate current readback across imported origins cannot spend the limit per origin', async () => {
  const item = fixture(); item.setCensus(empty);
  await bindPlaywrightStorageContext(item.context, item.prepare, item.controller.signal);
  const state = { cookies: [], origins: [origin, 'https://second.example'].map(origin => ({ origin, localStorage: [] })) };
  await replacePlaywrightStorageState(item.context, state, item.options);
  item.setReadback({ origin, localStorage: [{ name: 'current', value: 'x'.repeat(160) }], indexedDB: [] });
  const clears = item.events.filter(event => event === 'cookies.clear').length;
  await assert.rejects(replacePlaywrightStorageState(item.context, empty, { ...item.options, maxBytes: 400 }), /limit/);
  assert.equal(item.events.filter(event => event === 'cookies.clear').length, clears);
});
