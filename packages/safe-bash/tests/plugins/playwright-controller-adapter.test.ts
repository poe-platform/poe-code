import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightAdapter, type PlaywrightAcquireOptions, type PlaywrightContext } from '../../src/playwright/index.js';

test('malformed acquisition options are rejected before invoking trusted sources', async () => {
  let calls = 0;
  const adapter = createPlaywrightAdapter({ chromium: { headed: true, async acquireBrowser() { calls++; throw new Error('effect'); } } });
  const request = { acquisitionId: 'a1', session: 'demo', browser: 'chromium', headless: true, signal: new AbortController().signal };
  for (const override of [{ headless: 'yes' }, { session: '' }, { acquisitionId: '' }, { channel: 'chrome' }, { signal: undefined }]) {
    await assert.rejects(adapter.acquire({ ...request, ...override } as unknown as PlaywrightAcquireOptions));
  }
  assert.equal(calls, 0);
});

test('invalid capability declarations are refused rather than normalized', () => {
  const acquireBrowser = async () => { throw new Error('unused'); };
  for (const sources of [{ chromium: { headed: 'yes', acquireBrowser } }, { chrome: { acquireBrowser } }, { chromium: { acquireBrowser, channel: 'chrome' } }]) {
    assert.throws(() => createPlaywrightAdapter(sources as unknown as Parameters<typeof createPlaywrightAdapter>[0]));
  }
});

test('failed context retirement still detaches a released borrowed lease and preserves its cause', async () => {
  const closeError = new Error('context retirement failed');
  const browserListeners = new Set<() => void>();
  const contextListeners = new Set<() => void>();
  let releases = 0;
  let notifications = 0;
  const context: PlaywrightContext = {
    newPage: async () => { throw new Error('unused'); }, pages: () => [],
    close: async () => { throw closeError; },
    on: (_event, listener) => { contextListeners.add(listener); },
    off: (_event, listener) => { contextListeners.delete(listener); },
  };
  const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    return {
      browser: {
        isConnected: () => true, newContext: async () => context,
        on: (_event, listener) => { browserListeners.add(listener); },
        off: (_event, listener) => { browserListeners.delete(listener); },
      },
      release: async () => { releases++; },
    };
  } } });
  const lease = await adapter.acquire({ acquisitionId: 'a1', session: 'borrowed', browser: 'chromium', headless: true, signal: new AbortController().signal });
  lease.onClosed(() => { notifications++; });
  const retirement = lease.release();
  assert.equal(lease.release(), retirement);
  await assert.rejects(retirement, error => error === closeError);
  assert.equal(releases, 1);
  assert.equal(browserListeners.size, 0);
  assert.equal(contextListeners.size, 0);
  assert.equal(notifications, 1);
  lease.onClosed(() => { notifications++; });
  assert.equal(notifications, 2);
});
