import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { PlaywrightAdapter, PlaywrightPage } from './playwright/adapter.js';
import { createPlaywrightController } from './playwright/controller.js';

for (const firstClose of ['close', 'close-all', 'kill-all']) {
  test(`close-all after ${firstClose} leaves the controller reusable`, async () => {
    let acquisitions = 0;
    let releases = 0;
    const adapter: PlaywrightAdapter = {
      browsers: { chromium: { headed: false } },
      async acquire() {
        acquisitions++;
        let closed = false;
        const pages: PlaywrightPage[] = [];
        const context = Object.assign(new EventEmitter(), {
          pages: () => [...pages],
          async newPage() {
            const page: PlaywrightPage = Object.assign(new EventEmitter(), {
              url: () => 'about:blank', async goto() {}, frames: () => [],
              async title() { return 'synthetic'; }, async close() {},
              async screenshot() { return new Uint8Array(); },
              locator() { throw new Error('unexpected locator'); }, keyboard: { async press() {} },
            });
            pages.push(page);
            return page;
          },
          async close() {},
        });
        return {
          context, onClosed: () => () => {},
          async checkTrace() {
            if (closed) throw new Error('Playwright lease is closed');
          },
          async release() { closed = true; releases++; },
        };
      },
    };
    const controller = createPlaywrightController({ adapter });
    const run = (args: string[]) => controller.run({
      args, env: {}, signal: new AbortController().signal, async write() {},
    });
    try {
      await run(['open']);
      await run([firstClose]);
      await run(['close-all']);
      await run(['close-all']);
      assert.equal(releases, 1);
      await run(['open']);
      assert.equal(acquisitions, 2);
      await run(['close-all']);
      assert.equal(releases, 2);
    } finally { await controller.dispose(); }
  });
}
