import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightAdapter, type PlaywrightContext } from '../../src/playwright/adapter.js';

function fixture() {
  const calls: unknown[] = [];
  const contexts: (PlaywrightContext & EventEmitter)[] = [];
  const browser = Object.assign(new EventEmitter(), {
    isConnected: () => true,
    async newContext(options?: unknown) {
      calls.push(options);
      const context = Object.assign(new EventEmitter(), { pages: () => [], newPage: async () => { throw new Error('unused'); }, close: async () => { context.emit('close'); } });
      contexts.push(context);
      return context;
    },
  });
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser, release: async () => { calls.push('released'); } }) } });
  return { adapter, browser, calls, contexts };
}
const acquisition = () => ({ acquisitionId: 'a', session: 's', browser: 'chromium' as const, headless: true, signal: new AbortController().signal });

test('canonical CLI device catalog supplies current mobile defaults and preserves provider overrides', () => {
  const adapter = createPlaywrightAdapter({});
  assert.equal(Object.keys(adapter.devices ?? {}).length, 207);
  assert.deepEqual(adapter.devices?.['Pixel 10']?.viewport, { width: 360, height: 732 });
  assert.deepEqual(adapter.devices?.['iPhone 17']?.viewport, { width: 402, height: 681 });
  const device = { ...adapter.devices!['Pixel 10']!, userAgent: 'provider version' };
  const overridden = createPlaywrightAdapter({}, { devices: { 'Pixel 10': device } });
  assert.equal(overridden.devices?.['Pixel 10']?.userAgent, 'provider version');
  assert.deepEqual(overridden.devices?.['iPhone 17'], adapter.devices?.['iPhone 17']);
});

test('native upload buffer preparation preserves bytes and rejects invalid host buffers or a closed lease', async () => {
  const f = fixture();
  let invalid = false;
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser: f.browser, release: async () => {}, prepareFileBytes: bytes => invalid ? new Uint8Array(bytes.length + 1) : Buffer.from(bytes) }) } });
  const lease = await adapter.acquire(acquisition());
  const original = Uint8Array.of(0, 255, 1);
  const prepared = lease.prepareFileBytes!(original);
  assert.ok(Buffer.isBuffer(prepared));
  original[0] = 42;
  assert.deepEqual([...prepared], [0, 255, 1]);
  invalid = true;
  assert.throws(() => lease.prepareFileBytes!(original), /Invalid/);
  await lease.release();
  assert.throws(() => lease.prepareFileBytes!(original), /closed/);
});

test('native code execution keeps its owned lease until pending work settles', async () => {
  const f = fixture();
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  let released = false;
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser: f.browser,
    executeCode: async () => { started(); return pending; }, release: async () => { released = true; },
  }) } });
  const lease = await adapter.acquire(acquisition());
  const options = { page: {} as import('../../src/playwright/adapter.js').PlaywrightPage, source: 'page => page.title()',
    signal: new AbortController().signal, timeoutMs: 100, maxOutputBytes: 100, maxPages: 2 };
  const execution = lease.executeCode!(options);
  await admitted;
  const releasing = lease.release();
  await Promise.resolve();
  assert.equal(released, false);
  await assert.rejects(lease.executeCode!(options), /closed/);
  finish('native');
  assert.equal(await execution, 'native');
  await releasing;
  assert.equal(released, true);
});

test('storage replacement creates a new owned context without invalidating the lease', async () => {
  const f = fixture();
  const lease = await f.adapter.acquire(acquisition());
  let closed = 0;
  lease.onClosed(() => { closed++; });
  const state = { cookies: [], origins: [] };
  assert.equal(typeof lease.replaceContext, 'function');
  await lease.replaceContext!(state);
  assert.equal(lease.context, f.contexts[1]);
  assert.deepEqual(f.calls, [undefined, { storageState: state }]);
  assert.equal(closed, 0);
  assert.equal(f.contexts[0]!.listenerCount('close'), 0);
  await lease.release();
  assert.equal(closed, 1);
});

test('native context options and device descriptors remain owned across storage replacement', async () => {
  const f = fixture();
  const device = { userAgent: 'mobile user agent', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, defaultBrowserType: 'chromium' as const };
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser: f.browser, release: async () => {} }) } }, { devices: { Phone: device } });
  const contextOptions = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, locale: 'fr-FR' };
  const lease = await adapter.acquire({ ...acquisition(), contextOptions });
  contextOptions.viewport.width = 999;
  device.viewport.width = 999;
  const state = { cookies: [], origins: [] };
  await lease.replaceContext!(state);
  assert.deepEqual(f.calls, [
    { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, locale: 'fr-FR' },
    { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, locale: 'fr-FR', storageState: state },
  ]);
  assert.equal(adapter.devices?.Phone?.viewport.width, 390);
  await lease.release();
});

test('failed replacement preserves the active context and cancellation retires a late replacement', async () => {
  const f = fixture();
  const lease = await f.adapter.acquire(acquisition());
  const original = lease.context;
  const create = f.browser.newContext;
  f.browser.newContext = async () => { throw new Error('replacement failed'); };
  await assert.rejects(lease.replaceContext!({ cookies: [], origins: [] }), /replacement failed/);
  assert.equal(lease.context, original);
  const abort = new AbortController();
  let retired = false;
  f.browser.newContext = async options => {
    const fresh = await create(options);
    fresh.close = async () => { retired = true; };
    abort.abort(new Error('cancelled replacement'));
    return fresh;
  };
  await assert.rejects(lease.replaceContext!({ cookies: [], origins: [] }, { signal: abort.signal }), /cancelled replacement/);
  assert.equal(retired, true);
  assert.equal(lease.context, original);
  await lease.release();
});

test('artifact capture drains the admitted producer before release, rejecting early host acknowledgement', async () => {
  const f = fixture();
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let released = false;
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser: f.browser,
    captureArtifact: async produce => { void produce('/tmp/owned.zip'); started(); return Uint8Array.of(1); },
    release: async () => { released = true; },
  }) } });
  const lease = await adapter.acquire(acquisition());
  const capturing = lease.captureArtifact!(async () => { await pending; }, { signal: new AbortController().signal, maxBytes: 10, extension: 'zip' });
  await admitted;
  const releasing = lease.release();
  await Promise.resolve();
  assert.equal(released, false);
  complete();
  await assert.rejects(capturing, /acknowledged before/);
  await releasing;
  assert.equal(released, true);
});
