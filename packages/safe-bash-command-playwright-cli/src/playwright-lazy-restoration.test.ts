import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { PlaywrightAdapter, PlaywrightPage } from './playwright/adapter.js';
import { createPlaywrightController } from './playwright/controller.js';
import { checkpointBrowserProfile, parseBrowserProfile, restoreBrowserProfile, type BrowserProfile } from './playwright/profile.js';

function fixture() {
  let profile: BrowserProfile = { state: { cookies: [], origins: [] },
    tabs: ['https://example.test/slow', 'https://example.test/selected', 'https://example.test/last'], selected: 1 };
  const navigated: string[] = [];
  let cancelNavigation: (() => void) | undefined;
  let slowReady = false;
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire() {
      const pages: PlaywrightPage[] = [];
      let rejectNavigation: ((error: Error) => void) | undefined;
      const context = Object.assign(new EventEmitter(), {
        pages: () => [...pages],
        storageState: async () => profile.state,
        async newPage() {
          let url = 'about:blank';
          const page: PlaywrightPage = Object.assign(new EventEmitter(), {
            url: () => url,
            async goto(next: string) {
              navigated.push(next);
              if (next.endsWith('/slow') && !slowReady) {
                if (!cancelNavigation) throw new Error('controlled slow navigation exceeded budget');
                await new Promise<void>((_resolve, reject) => {
                  rejectNavigation = reject;
                  cancelNavigation!();
                });
              }
              url = next;
            },
            async title() { return 'synthetic'; }, async close() { pages.splice(pages.indexOf(page), 1); },
            async screenshot() { return new Uint8Array(); },
            locator() { throw new Error('unexpected locator'); }, keyboard: { async press() {} },
          });
          pages.push(page);
          return page;
        }, async close() {},
      });
      return { context, onClosed: () => () => {}, async release() { rejectNavigation?.(new Error('lease released')); } };
    },
  };
  const controller = createPlaywrightController({ adapter, namedSessionAttachment: true, persistence: {
    resumeAfterIdle: true,
    async list() { return [{ name: 'saved' }]; },
    async restore({ name, signal }) { return restoreBrowserProfile({ adapter, profile, name, signal, tabRestoration: 'navigate' }); },
    async checkpoint(session, signal) { profile = parseBrowserProfile(await checkpointBrowserProfile(session, undefined, signal)); },
    async delete() {},
  } });
  return { controller, navigated, get profile() { return profile; },
    allowSlow() { slowReady = true; },
    cancelWith(callback: () => void) { cancelNavigation = callback; },
    async run(args: string[], signal = new AbortController().signal) {
      let output = '';
      await controller.run({ args, env: {}, signal, async write(value) { output += value; }, async writeArtifact() {} });
      return output;
    },
  };
}

test('attach and tab-list preserve every saved URL without waiting for slow navigation', async () => {
  const host = fixture();
  const original = structuredClone(host.profile);
  try {
    await host.run(['attach', 'saved']);
    assert.deepEqual(host.navigated, []);
    assert.deepEqual(host.profile, { ...original, contextOptions: {} });
    const tabs = await host.run(['-s=saved', 'tab-list']);
    for (const url of original.tabs) assert.ok(tabs.includes(url));
    assert.ok(tabs.includes('1: (current)'));
    await host.run(['-s=saved', 'snapshot']);
    assert.deepEqual(host.navigated, [original.tabs[1]]);
    await host.run(['-s=saved', 'tab-select', '2']);
    assert.deepEqual(host.navigated, [original.tabs[1], original.tabs[2]]);
    assert.deepEqual(host.profile.tabs, original.tabs);
    assert.equal(host.profile.selected, 2);
    await host.run(['-s=saved', 'snapshot']);
    assert.equal(host.navigated.length, 2);
    host.allowSlow();
    await host.run(['-s=saved', 'tab-select', '0']);
    assert.deepEqual(host.navigated, [original.tabs[1], original.tabs[2], original.tabs[0]]);
    assert.equal(host.profile.selected, 0);
  } finally { await host.controller.dispose(); }
});

test('cancellation retains the durable profile and subsequent tab-list can recover', async () => {
  const host = fixture();
  try {
    await host.run(['attach', 'saved']);
    const original = structuredClone(host.profile);
    const abort = new AbortController();
    host.cancelWith(() => abort.abort(new Error('navigation budget exhausted')));
    await assert.rejects(host.run(['-s=saved', 'tab-select', '0'], abort.signal), /navigation budget exhausted/);
    assert.deepEqual(host.profile, original);
    const output = await host.run(['-s=saved', 'tab-list']);
    assert.ok(output.includes(original.tabs[0]!));
    assert.equal(host.profile.selected, 1);
    await host.run(['-s=saved', 'tab-select', '2']);
    assert.equal(host.profile.selected, 2);
  } finally { await host.controller.dispose(); }
});


test('explicit goto replaces a deferred destination without replaying it', async () => {
  const host = fixture();
  try {
    await host.run(['attach', 'saved']);
    await host.run(['-s=saved', 'goto', 'about:blank']);
    await host.run(['-s=saved', 'snapshot']);
    assert.deepEqual(host.navigated, ['about:blank']);
    assert.deepEqual(host.profile.tabs, ['https://example.test/slow', 'about:blank', 'https://example.test/last']);
  } finally { await host.controller.dispose(); }
});

test('closing a deferred tab never navigates it and preserves the remaining destinations', async () => {
  const host = fixture();
  try {
    await host.run(['attach', 'saved']);
    await host.run(['-s=saved', 'tab-close', '0']);
    assert.deepEqual(host.navigated, []);
    assert.deepEqual(host.profile.tabs, ['https://example.test/selected', 'https://example.test/last']);
    assert.equal(host.profile.selected, 0);
  } finally { await host.controller.dispose(); }
});
