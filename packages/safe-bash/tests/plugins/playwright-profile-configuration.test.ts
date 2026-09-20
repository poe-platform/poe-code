import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createPlaywrightAdapter, type BrowserEngine, type PlaywrightAdapter, type PlaywrightBrowser, type PlaywrightLease, type PlaywrightPage, type PlaywrightStorageState } from '../../src/playwright/adapter.js';
import { restoreBrowserProfile, type BrowserProfile, type BrowserProfileContext } from '../../src/playwright/profile.js';
import type { PlaywrightSessionPersistence } from '../../src/playwright/controller.js';
import type { PlaywrightSessionConfiguration } from '../../src/playwright/session-configuration.js';

const state: PlaywrightStorageState = { cookies: [], origins: [] };
const limits = { maxBytes: 4096, maxTabs: 2 };
const profile: BrowserProfile = { state, tabs: ['https://first.example/', 'https://second.example/'], selected: 1 };

function host() {
  const pages: PlaywrightPage[] = [];
  const newPage = mock.fn(async () => {
    const page = { url: () => 'about:blank', goto: mock.fn(async (_url: string) => {}), close: mock.fn(async () => {}) } as unknown as PlaywrightPage;
    pages.push(page);
    return page;
  });
  const context = { pages: () => [...pages], newPage, async close() {}, on() {}, off() {} } as unknown as BrowserProfileContext;
  const release = mock.fn(async () => {});
  const lease: PlaywrightLease = { context, release, onClosed: () => () => {} };
  const acquire = mock.fn<PlaywrightAdapter['acquire']>(async () => lease);
  const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: true }, firefox: { headed: true }, webkit: { headed: true } }, acquire };
  const controller = new AbortController();
  return { pages, newPage, context, release, lease, acquire, controller, options: { adapter, profile, limits, name: 'configured', signal: controller.signal } };
}

for (const browserName of ['chromium', 'firefox', 'webkit'] as const) {
  for (const headless of [true, false]) {
    test(`restore acquires stored ${browserName} with headless=${headless}`, async () => {
      const item = host();
      const configuration: PlaywrightSessionConfiguration = { browserName, headless };
      const restored = await restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration } });
      const acquired = item.acquire.mock.calls[0]!.arguments[0];
      assert.equal(acquired.browser, browserName);
      assert.equal(acquired.headless, headless);
      assert.deepEqual(restored.configuration, configuration);
      assert.equal(restored.selectedPage, item.pages[1]);
      assert.equal(item.release.mock.callCount(), 0);
    });
  }
}

const defaults: { configuration?: PlaywrightSessionConfiguration; browser: BrowserEngine; headless: boolean }[] = [
  { browser: 'chromium', headless: true },
  { configuration: {}, browser: 'chromium', headless: true },
  { configuration: { headless: false }, browser: 'chromium', headless: false },
  { configuration: { browserName: 'firefox' }, browser: 'firefox', headless: true },
  { configuration: { browserName: 'webkit' }, browser: 'webkit', headless: true },
];
for (const [index, expected] of defaults.entries()) {
  test(`restore keeps legacy defaults for omitted configuration fields ${index}`, async () => {
    const item = host();
    const value = { ...profile, ...(expected.configuration === undefined ? {} : { configuration: expected.configuration }) };
    await restoreBrowserProfile({ ...item.options, profile: value });
    const acquired = item.acquire.mock.calls[0]!.arguments[0];
    assert.equal(acquired.browser, expected.browser);
    assert.equal(acquired.headless, expected.headless);
  });
}

test('restore propagates unsupported browser decisions without acquiring the legacy browser', async () => {
  const item = host();
  const browser: PlaywrightBrowser = { isConnected: () => true, async newContext() { return item.context; }, on() {}, off() {} };
  const acquireBrowser = mock.fn(async () => ({ browser, release: item.release }));
  const adapter = createPlaywrightAdapter({ chromium: { headed: true, acquireBrowser } });
  await assert.rejects(restoreBrowserProfile({ ...item.options, adapter, profile: { ...profile, configuration: { browserName: 'firefox' } } }), { message: 'Unsupported browser: firefox' });
  assert.equal(acquireBrowser.mock.callCount(), 0);
  assert.equal(item.newPage.mock.callCount(), 0);
});

test('restore propagates unsupported headed decisions instead of silently switching to headless', async () => {
  const item = host();
  const browser: PlaywrightBrowser = { isConnected: () => true, async newContext() { return item.context; }, on() {}, off() {} };
  const acquireBrowser = mock.fn(async () => ({ browser, release: item.release }));
  const adapter = createPlaywrightAdapter({ chromium: { headed: false, acquireBrowser } });
  await assert.rejects(restoreBrowserProfile({ ...item.options, adapter, profile: { ...profile, configuration: { browserName: 'chromium', headless: false } } }), { message: 'Headed mode is unsupported for chromium' });
  assert.equal(acquireBrowser.mock.callCount(), 0);
  assert.equal(item.newPage.mock.callCount(), 0);
});

for (const { configuration, message } of [
  { configuration: { browserName: 'unsupported' }, message: 'Invalid configured browser' },
  { configuration: { headless: 'false' }, message: 'Invalid configured headless mode' },
]) {
  test(`restore rejects invalid configuration before acquisition ${JSON.stringify(configuration)}`, async () => {
    const item = host();
    await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration } as unknown as BrowserProfile }), { message });
    assert.equal(item.acquire.mock.callCount(), 0);
    assert.equal(item.newPage.mock.callCount(), 0);
  });
}

test('configured restore preserves storage/context settings and defers runtime restoration and navigation', async () => {
  const item = host();
  const events: string[] = [];
  const runtimeState = { offline: true, locale: 'pl' };
  const restore = mock.fn(async (_state: unknown, _signal: AbortSignal) => { events.push('runtime'); });
  Object.assign(item.context, { browserProfile: { async capture() {}, restore } });
  const value: BrowserProfile = {
    ...profile, runtimeState, contextOptions: { locale: 'pl', viewport: { width: 700, height: 500 } },
    configuration: { browserName: 'firefox', headless: false, timeouts: { navigation: 1234 } }, expiresAt: 100, idleTimeoutMs: 123,
  };
  const restored: NonNullable<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>> = await restoreBrowserProfile({ ...item.options, profile: value });
  const acquired = item.acquire.mock.calls[0]!.arguments[0];
  assert.equal(acquired.session, 'configured');
  assert.equal(typeof acquired.acquisitionId, 'string');
  assert.equal(acquired.signal, item.controller.signal);
  assert.deepEqual(acquired.contextOptions, { ...value.contextOptions, storageState: state });
  assert.deepEqual(restored.contextOptions, value.contextOptions);
  assert.deepEqual(restored.configuration, value.configuration);
  assert.equal(restored.expiresAt, value.expiresAt);
  assert.equal(restored.idleTimeoutMs, value.idleTimeoutMs);
  assert.equal(restored.selectedPage, item.pages[1]);
  assert.equal(events.length, 0);
  for (const page of item.pages) page.goto = mock.fn(async url => { events.push(url); });
  await restored.initialize!({ signal: item.controller.signal });
  assert.deepEqual(events, ['runtime', ...profile.tabs]);
  assert.deepEqual(restore.mock.calls[0]!.arguments, [runtimeState, item.controller.signal]);
  assert.equal(item.release.mock.callCount(), 0);
});

test('configured restore observes initial cancellation without acquisition', async () => {
  const item = host();
  const cancellation = new Error('cancelled configured restoration');
  item.controller.abort(cancellation);
  await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration: { browserName: 'webkit', headless: false } } }), error => error === cancellation);
  assert.equal(item.acquire.mock.callCount(), 0);
});

test('configured restore releases a lease acquired after cancellation without allocating pages', async () => {
  const item = host();
  const cancellation = new Error('cancelled configured acquisition');
  item.acquire.mock.mockImplementation(async () => { item.controller.abort(cancellation); return item.lease; });
  await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration: { browserName: 'firefox', headless: false } } }), error => error === cancellation);
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 1);
});

test('configured restore retains allocation and release failure aggregation', async () => {
  const item = host();
  const allocation = new Error('configured allocation failed');
  const cleanup = new Error('configured lease release failed');
  item.newPage.mock.mockImplementationOnce(async () => { throw allocation; });
  item.release.mock.mockImplementation(async () => { throw cleanup; });
  await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration: { browserName: 'webkit', headless: false } } }), { errors: [allocation, cleanup] });
  assert.equal(item.release.mock.callCount(), 1);
});

test('configured restore preserves explicit provider acquisition rejection identity', async () => {
  const item = host();
  const providerDecision = new Error('provider policy rejects this session');
  item.acquire.mock.mockImplementation(async () => { throw providerDecision; });
  await assert.rejects(restoreBrowserProfile({ ...item.options, profile: { ...profile, configuration: { browserName: 'firefox', headless: false } } }), error => error === providerDecision);
  const acquired = item.acquire.mock.calls[0]!.arguments[0];
  assert.equal(acquired.browser, 'firefox');
  assert.equal(acquired.headless, false);
  assert.equal(item.newPage.mock.callCount(), 0);
  assert.equal(item.release.mock.callCount(), 0);
});
