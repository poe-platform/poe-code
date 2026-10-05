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

for (const failure of ['release', 'checkpoint']) {
  test(`dispose retries cleanup after a transient ${failure} failure`, async () => {
    let healthy = false;
    let releases = 0;
    let checkpoints = 0;
    const context = Object.assign(new EventEmitter(), { pages: () => [], async newPage() { throw new Error('unexpected page'); }, async close() {} });
    const controller = createPlaywrightController({
      adapter: { browsers: {}, async acquire() { throw new Error('unexpected acquisition'); } },
      persistence: {
        async restore() { return undefined; }, async delete() {},
        async checkpoint() {
          checkpoints++;
          if (!healthy && failure === 'checkpoint') throw new Error('checkpoint unavailable');
        },
      },
    });
    await controller.restoreSession({ name: 'owned', async acquire() {
      return { lease: { context, onClosed: () => () => {}, async release() {
        releases++;
        if (!healthy && failure === 'release') throw new Error('release unavailable');
      } } };
    } });
    const first = controller.dispose();
    assert.equal(controller.dispose(), first);
    await assert.rejects(first);
    assert.deepEqual(controller.inspectSessions(), []);
    assert.equal(controller.renewSession({ name: 'owned', context }), false);
    const savedCheckpoints = checkpoints;
    if (failure === 'release') {
      await assert.rejects(controller.dispose());
      assert.equal(releases, 2);
    }
    healthy = true;
    const retry = controller.dispose();
    assert.equal(controller.dispose(), retry);
    await retry;
    await controller.dispose();
    assert.equal(releases, failure === 'release' ? 3 : 1);
    assert.equal(checkpoints, savedCheckpoints);
    assert.ok(checkpoints > 0);
    await assert.rejects(controller.restoreSession({ name: 'owned', async acquire() {
      throw new Error('must remain retired');
    } }), /disposed/);
  });
}
