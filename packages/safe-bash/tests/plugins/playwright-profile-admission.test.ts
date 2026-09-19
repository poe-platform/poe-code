import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { PlaywrightAdapter, PlaywrightLease, PlaywrightPage, PlaywrightStorageState } from '../../src/playwright/adapter.js';
import type { PlaywrightSessionCheckpoint, PlaywrightSessionPersistence } from '../../src/playwright/controller.js';
import type { readPlaywrightStorageState } from '../../src/playwright/native-storage-replacement.js';
import { checkpointBrowserProfile, encodeBrowserProfile, parseBrowserProfile, restoreBrowserProfile, type BrowserProfile, type BrowserProfileContext, type BrowserProfileLimits } from '../../src/playwright/profile.js';

const limits: BrowserProfileLimits = { maxBytes: 4096, maxTabs: 2 };
const state: PlaywrightStorageState = { cookies: [], origins: [] };
const profile: BrowserProfile = { state, tabs: ['https://first.example/', 'https://second.example/'], selected: 1 };

function host(existingCount = 0) {
  const pages: PlaywrightPage[] = [];
  const newPage = mock.fn(async () => {
    const page = { url: () => 'about:blank', goto: mock.fn(async (_url: string) => {}), close: mock.fn(async () => {}) } as unknown as PlaywrightPage;
    pages.push(page);
    return page;
  });
  for (let index = 0; index < existingCount; index++) {
    pages.push({ url: () => `https://existing.example/${index}`, goto: mock.fn(async (_url: string) => {}), close: mock.fn(async () => {}) } as unknown as PlaywrightPage);
  }
  const read = mock.fn(async (_options?: { indexedDB?: boolean }) => state);
  const context = { pages: () => [...pages], newPage, storageState: read } as unknown as BrowserProfileContext;
  const release = mock.fn(async () => {});
  const lease: PlaywrightLease = { context, release, onClosed: () => () => {} };
  const acquire = mock.fn<PlaywrightAdapter['acquire']>(async () => lease);
  const adapter = { acquire } as unknown as PlaywrightAdapter;
  const controller = new AbortController();
  const session: PlaywrightSessionCheckpoint = { name: 'audit', context };
  return { pages, newPage, read, context, release, acquire, controller, session, options: { adapter, profile, limits, name: 'audit', signal: controller.signal } };
}

test('checkpoint rejects a foreign selected page before reading storage', async () => {
  const item = host(1);
  await assert.rejects(checkpointBrowserProfile({ ...item.session, selectedPage: {} as PlaywrightPage }, limits, item.controller.signal));
  assert.equal(item.read.mock.callCount(), 0);
});

test('checkpoint rejects selection that becomes stale during the storage read', async () => {
  const item = host(2);
  const selectedPage = item.pages[1]!;
  item.read.mock.mockImplementation(async () => { item.pages.pop(); return state; });
  await assert.rejects(checkpointBrowserProfile({ ...item.session, selectedPage }, limits, item.controller.signal));
  assert.equal(item.read.mock.callCount(), 1);
});

test('checkpoint rejects selection that becomes stale during provider capture', async () => {
  const item = host(2);
  const selectedPage = item.pages[1]!;
  const capture = mock.fn(async () => { item.pages.pop(); return { locale: 'pl' }; });
  Object.assign(item.context, { browserProfile: { capture, async restore() {} } });
  await assert.rejects(checkpointBrowserProfile({ ...item.session, selectedPage }, limits, item.controller.signal));
  assert.equal(capture.mock.callCount(), 1);
});

test('checkpoint rejects an oversized tab list before storage read or provider capture', async () => {
  const item = host(3);
  const capture = mock.fn(async () => ({}));
  Object.assign(item.context, { browserProfile: { capture, async restore() {} } });
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal));
  assert.equal(item.read.mock.callCount(), 0);
  assert.equal(capture.mock.callCount(), 0);
});

test('checkpoint revalidates tabs added during storage read', async () => {
  const item = host(2);
  item.read.mock.mockImplementation(async () => { item.pages.push(item.pages[0]!); return state; });
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal));
  assert.equal(item.read.mock.callCount(), 1);
});

test('checkpoint revalidates tabs added during provider capture', async () => {
  const item = host(2);
  const capture = mock.fn(async () => { item.pages.push(item.pages[0]!); return {}; });
  Object.assign(item.context, { browserProfile: { capture, async restore() {} } });
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal));
  assert.equal(capture.mock.callCount(), 1);
});

test('checkpoint preserves settings, normalized context options and provider runtime state', async () => {
  const item = host(2);
  const runtimeState = { offline: true, viewport: { width: 700, height: 500 } };
  const capture = mock.fn(async (_signal: AbortSignal) => runtimeState);
  Object.assign(item.context, { browserProfile: { capture, async restore() {} } });
  const contextOptions = { locale: 'pl', storageState: state };
  const session = { ...item.session, selectedPage: item.pages[1]!, contextOptions, expiresAt: 0, idleTimeoutMs: 123, configuration: { headless: false } };
  const encoded = await checkpointBrowserProfile(session, limits, item.controller.signal);
  assert.deepEqual(parseBrowserProfile(encoded, limits), {
    state, tabs: item.pages.map(page => page.url()), selected: 1, contextOptions: { locale: 'pl' },
    expiresAt: 0, idleTimeoutMs: 123, configuration: session.configuration, runtimeState,
  });
  assert.equal(contextOptions.storageState, state);
  assert.deepEqual(capture.mock.calls[0]!.arguments, [item.controller.signal]);
  assert.deepEqual(item.read.mock.calls[0]!.arguments, [{ indexedDB: true }]);
});

test('checkpoint keeps optional context options normalized to an empty object', async () => {
  const item = host();
  assert.deepEqual(parseBrowserProfile(await checkpointBrowserProfile(item.session, limits, item.controller.signal), limits), { state, tabs: [], selected: 0, contextOptions: {} });
});

test('checkpoint does not read after initial cancellation', async () => {
  const item = host(1);
  const cancellation = new Error('cancelled checkpoint');
  item.controller.abort(cancellation);
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal), error => error === cancellation);
  assert.equal(item.read.mock.callCount(), 0);
});

test('checkpoint preserves storage and provider-capture failure identity', async () => {
  const item = host(1);
  const failure = new Error('storage read failed');
  item.read.mock.mockImplementationOnce(async () => { throw failure; });
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal), error => error === failure);
  const captureFailure = new Error('provider capture failed');
  Object.assign(item.context, { browserProfile: { async capture() { throw captureFailure; }, async restore() {} } });
  await assert.rejects(checkpointBrowserProfile(item.session, limits, item.controller.signal), error => error === captureFailure);
});

const invalidLimits = [
  { maxBytes: 0, maxTabs: 2 }, { maxBytes: 4096, maxTabs: 0 },
  { maxBytes: Infinity, maxTabs: 2 }, { maxBytes: 4096, maxTabs: 0.5 },
  undefined as unknown as BrowserProfileLimits,
];
for (const [index, invalid] of invalidLimits.entries()) {
  test(`encoder rejects invalid limits ${index} before serialization or UTF-8 output`, () => {
    const serialize = mock.fn(() => ({}));
    const encode = mock.method(TextEncoder.prototype, 'encode');
    try {
      assert.throws(() => encodeBrowserProfile({ ...profile, runtimeState: { toJSON: serialize } }, invalid), TypeError);
      assert.equal(serialize.mock.callCount(), 0);
      assert.equal(encode.mock.callCount(), 0);
    } finally { encode.mock.restore(); }
  });
}

test('encoder rejects known oversized tabs before serializing runtime state', () => {
  const serialize = mock.fn(() => ({}));
  const encode = mock.method(TextEncoder.prototype, 'encode');
  try {
    assert.throws(() => encodeBrowserProfile({ ...profile, tabs: [...profile.tabs, 'about:blank'], runtimeState: { toJSON: serialize } }, limits));
    assert.equal(serialize.mock.callCount(), 0);
    assert.equal(encode.mock.callCount(), 0);
  } finally { encode.mock.restore(); }
});

test('encoder rejects oversized serialized UTF-8 before allocating output bytes', () => {
  const value = { ...profile, runtimeState: { text: 'x'.repeat(1024) } };
  const encode = mock.method(TextEncoder.prototype, 'encode');
  try {
    assert.throws(() => encodeBrowserProfile(value, { ...limits, maxBytes: 64 }), { message: 'Browser profile byte limit exceeded' });
    assert.equal(encode.mock.callCount(), 0);
  } finally { encode.mock.restore(); }
});

for (const text of ['ASCII', 'é', '中文', '😀', '\ud800', '\u0000\n"\\']) {
  test(`encoder preserves exact UTF-8 bounds and ordinary JSON runtime semantics for ${JSON.stringify(text)}`, () => {
    const runtimeState = { text, infinity: Infinity, absent: undefined, negativeZero: -0, nested: { toJSON() { return ['owned', null]; } } };
    const value = { ...profile, runtimeState };
    const expected = new TextEncoder().encode(JSON.stringify(value));
    const exact = { ...limits, maxBytes: expected.byteLength };
    assert.deepEqual(encodeBrowserProfile(value, exact), expected);
    assert.deepEqual(parseBrowserProfile(expected, exact).runtimeState, JSON.parse(JSON.stringify(runtimeState)));
    assert.throws(() => encodeBrowserProfile(value, { ...exact, maxBytes: expected.byteLength - 1 }));
  });
}

test('restore rejects combined existing and restored tabs before allocating and releases without closing tabs', async () => {
  const item = host(1);
  const existing = item.pages[0]!;
  const close = mock.method(existing, 'close');
  await assert.rejects(restoreBrowserProfile(item.options));
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 1);
  assert.equal(close.mock.callCount(), 0);
  assert.deepEqual(item.pages, [existing]);
});

test('restore counts the blank fallback page against existing tabs', async () => {
  const item = host(1);
  await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { state, tabs: [], selected: 0 }, limits: { ...limits, maxTabs: 1 } }));
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 1);
});

test('restore aggregates combined-tab rejection and lease release failure', async () => {
  const item = host(1);
  const cleanup = new Error('admission release failed');
  item.release.mock.mockImplementation(async () => { throw cleanup; });
  await assert.rejects(restoreBrowserProfile(item.options), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[1], cleanup);
    return true;
  });
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 1);
});

test('restore accepts existing tabs within the combined limit and defers provider state and navigation', async () => {
  const item = host(1);
  const events: string[] = [];
  const runtimeState = { offline: true };
  const restore = mock.fn(async (_state: unknown, _signal: AbortSignal) => { events.push('restore'); });
  Object.assign(item.context, { browserProfile: { async capture() {}, restore } });
  const value = { ...profile, runtimeState, contextOptions: { locale: 'pl' }, configuration: { headless: false }, expiresAt: 100, idleTimeoutMs: 123 };
  const restored: NonNullable<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>> = await restoreBrowserProfile({ ...item.options, profile: value, limits: { ...limits, maxTabs: 3 } });
  assert.equal(item.pages.length, 3);
  assert.equal(restored.selectedPage, item.pages[2]);
  assert.equal(restored.expiresAt, value.expiresAt);
  assert.equal(restored.idleTimeoutMs, value.idleTimeoutMs);
  assert.deepEqual(restored.contextOptions, value.contextOptions);
  assert.deepEqual(restored.configuration, value.configuration);
  const acquired = item.acquire.mock.calls[0]!.arguments[0];
  assert.equal(acquired.browser, 'chromium');
  assert.equal(acquired.headless, true);
  assert.equal(acquired.session, 'audit');
  assert.equal(typeof acquired.acquisitionId, 'string');
  assert.deepEqual(acquired.contextOptions, { locale: 'pl', storageState: state });
  assert.equal(events.length, 0);
  for (const page of item.pages.slice(1)) page.goto = mock.fn(async url => { events.push(url); });
  await restored.initialize!({ signal: item.controller.signal });
  assert.deepEqual(events, ['restore', ...profile.tabs]);
  assert.deepEqual(restore.mock.calls[0]!.arguments, [runtimeState, item.controller.signal]);
  assert.equal(item.release.mock.callCount(), 0);
});

test('restore preserves acquired cancellation and aggregates cleanup without allocating', async () => {
  const item = host(1);
  const cancellation = new Error('cancelled acquired context');
  const cleanup = new Error('cancelled release failed');
  item.acquire.mock.mockImplementation(async () => { item.controller.abort(cancellation); return { context: item.context, release: item.release, onClosed: () => () => {} }; });
  item.release.mock.mockImplementation(async () => { throw cleanup; });
  await assert.rejects(restoreBrowserProfile(item.options), { errors: [cancellation, cleanup] });
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 1);
});

test('restore retains allocation failure and cleanup aggregation', async () => {
  const item = host();
  const allocation = new Error('allocation failed');
  const cleanup = new Error('allocation release failed');
  item.newPage.mock.mockImplementationOnce(async () => { throw allocation; });
  item.release.mock.mockImplementation(async () => { throw cleanup; });
  await assert.rejects(restoreBrowserProfile(item.options), { errors: [allocation, cleanup] });
});

test('restore leaves provider runtime failure retirement with the adopting controller', async () => {
  const item = host();
  const failure = new Error('provider restore failed');
  Object.assign(item.context, { browserProfile: { async capture() {}, async restore() { throw failure; } } });
  const restored = await restoreBrowserProfile({ ...item.options, profile: { ...profile, runtimeState: {} } });
  const goto = mock.method(item.pages[0]!, 'goto');
  await assert.rejects(restored.initialize!({ signal: item.controller.signal }), error => error === failure);
  assert.equal(goto.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 0);
});

const readerModule = 'data:text/javascript;base64,' + Buffer.from('let reader; export function setTestReader(value) { reader = value; } export function readPlaywrightStorageState(...args) { return reader(...args); }').toString('base64');
const bundled = await build({
  stdin: { contents: "export * from './profile.ts'; export { setTestReader } from './native-storage-replacement.js';", resolveDir: fileURLToPath(new URL('../../src/playwright/', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', external: ['./native-storage-replacement.js'],
});
const source = bundled.outputFiles[0]!.text.replaceAll('"./native-storage-replacement.js"', JSON.stringify(readerModule));
const isolated = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')) as typeof import('../../src/playwright/profile.js') & { setTestReader(reader: typeof readPlaywrightStorageState): void };

for (const outcome of ['read failure', 'cancellation', 'success']) {
  test(`checkpoint drains every registered cleanup and aggregates failures after ${outcome}`, async () => {
    const item = host(1);
    const primary = new Error(outcome);
    const first = new Error('first cleanup');
    const second = new Error('second cleanup');
    const drained: number[] = [];
    isolated.setTestReader(async (_context, options) => {
      assert.equal(options.indexedDB, true);
      assert.equal(options.maxBytes, limits.maxBytes);
      options.registerCleanup((): Promise<void> => { drained.push(1); throw first; });
      options.registerCleanup(async () => { drained.push(2); throw second; });
      options.registerCleanup(async () => { drained.push(3); });
      if (outcome === 'read failure') throw primary;
      if (outcome === 'cancellation') item.controller.abort(primary);
      return state;
    });
    await assert.rejects(isolated.checkpointBrowserProfile(item.session, limits, item.controller.signal), { errors: outcome === 'success' ? [first, second] : [primary, first, second] });
    assert.deepEqual(drained, [1, 2, 3]);
  });
}

test('checkpoint drains reader cleanups before rejecting stale selected ownership', async () => {
  const item = host(2);
  const selectedPage = item.pages[1]!;
  const first = mock.fn(async () => {});
  const second = mock.fn(async () => {});
  isolated.setTestReader(async (_context, options) => {
    options.registerCleanup(first);
    options.registerCleanup(second);
    item.pages.pop();
    return state;
  });
  await assert.rejects(isolated.checkpointBrowserProfile({ ...item.session, selectedPage }, limits, item.controller.signal));
  assert.equal(first.mock.callCount(), 1);
  assert.equal(second.mock.callCount(), 1);
});

test('checkpoint observes cancellation during cleanup and drains every later cleanup', async () => {
  const item = host(1);
  const cancellation = new Error('cancelled during reader cleanup');
  const first = mock.fn(async () => { item.controller.abort(cancellation); });
  const second = mock.fn(async () => {});
  isolated.setTestReader(async (_context, options) => {
    options.registerCleanup(first);
    options.registerCleanup(second);
    return state;
  });
  await assert.rejects(isolated.checkpointBrowserProfile(item.session, limits, item.controller.signal), error => error === cancellation);
  assert.equal(first.mock.callCount(), 1);
  assert.equal(second.mock.callCount(), 1);
});
