import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightCli, createPlaywrightController } from '../../src/commands/playwright/index.js';
import type { PlaywrightContext, PlaywrightLease, PlaywrightPage } from '../../src/playwright/index.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function retainedBrowser() {
  let createdPages = 0;
  let releases = 0;
  const navigations: string[] = [];
  const node = {
    isConnected: true, tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null,
  };
  const frame = createSnapshotFrame([{ node,
    native: { async click() {}, async fill() {}, async dispose() {}, async evaluate(callback) { return callback(node); } },
  }]);
  const pages = ['first', 'selected'].map(name => ({
    async goto(url: string) { navigations.push(name + ':' + url); },
    url: () => 'https://example.test/' + name,
    frames: () => [frame.frame], on() {}, off() {},
  } as unknown as PlaywrightPage));
  const context: PlaywrightContext = {
    async newPage() { createdPages++; return pages[0]!; }, pages: () => pages,
    async close() {}, on() {}, off() {},
  };
  const lease: PlaywrightLease = { context, onClosed: () => () => {}, async release() { releases++; } };
  const adapter = { browsers: { chromium: { headed: false } }, async acquire() { return lease; } };
  return { adapter, lease, context, pages, navigations, get createdPages() { return createdPages; }, get releases() { return releases; } };
}

function runner(controller: ReturnType<typeof createPlaywrightController>) {
  const output: string[] = [];
  return { output, run: (args: string[], env: Record<string, string> = {}) => controller.run({
    args, env, signal: new AbortController().signal, write: async text => { output.push(text); },
  }) };
}

for (const available of [false, true]) test(`listing a saved profile is metadata-only when restoration is ${available ? 'available' : 'unavailable'}`, async () => {
  const browser = retainedBrowser();
  let allocations = 0;
  let restores = 0;
  const oneTimeUrl = 'https://example.test/one-time';
  const controller = createPlaywrightController({
    adapter: { ...browser.adapter, async acquire() { allocations++; return browser.lease; } },
    persistence: {
      async list() { return [{ name: 'saved' }]; },
      async restore() {
        restores++;
        if (!available) throw new Error('browser acquisition unavailable');
        await browser.pages[1]!.goto(oneTimeUrl);
        return { lease: browser.lease, selectedPage: browser.pages[1]! };
      },
      async checkpoint() {}, async delete() {}, async close() {},
    },
  });
  const cli = runner(controller);
  try {
    await cli.run(['list', '--json']);
    assert.deepEqual(JSON.parse(cli.output.pop()!), { browsers: [{ name: 'saved', status: 'saved' }] });
    await cli.run(['list']);
    assert.equal(cli.output.pop(), '### Browsers\n- saved:\n  - status: saved\n');
    assert.equal(allocations, 0);
    assert.equal(restores, 0);
    assert.equal(browser.createdPages, 0);
    assert.deepEqual(browser.navigations, []);

    if (!available) {
      await assert.rejects(cli.run(['-s=saved', 'snapshot']), /browser acquisition unavailable/);
      assert.equal(restores, 1);
    } else {
      await controller.restoreSession({ name: 'saved', async acquire() {
        return { lease: browser.lease, selectedPage: browser.pages[1] };
      } });
      await cli.run(['list', '--json']);
      assert.deepEqual(JSON.parse(cli.output.pop()!), { browsers: [{ name: 'saved', status: 'open' }] });
      assert.equal(restores, 0);
      await cli.run(['-s=saved', 'close']);
      // Persistence deliberately keeps the alias: explicit close must still suppress it.
      await cli.run(['list', '--json']);
      assert.deepEqual(JSON.parse(cli.output.pop()!), { browsers: [] });
      await assert.rejects(cli.run(['-s=saved', 'snapshot']), /Session closed/);
      assert.equal(restores, 0);
      assert.deepEqual(browser.navigations, []);
    }
  } finally { await controller.dispose(); }
});

test('cold controller restores the same owned context and selected page without creating either', async () => {
  const browser = retainedBrowser();
  const first = createPlaywrightController({ adapter: browser.adapter });
  const original = runner(first);
  await original.run(['-s=owned', 'open']);
  await original.run(['-s=owned', 'tab-select', '1']);
  const second = createPlaywrightController({ adapter: browser.adapter });
  const restarted = runner(second);
  await assert.rejects(restarted.run(['snapshot'], { PLAYWRIGHT_CLI_SESSION: 'owned' }), /Session closed/);
  await second.restoreSession({ name: 'owned', async acquire() { return { lease: browser.lease, selectedPage: browser.pages[1] }; } });
  try {
    await restarted.run(['goto', 'https://example.test/restored'], { PLAYWRIGHT_CLI_SESSION: 'owned' });
    assert.deepEqual(browser.navigations, ['selected:https://example.test/restored']);
    assert.equal(browser.createdPages, 1);
    const [checkpoint] = second.inspectSessions();
    assert.equal(checkpoint!.name, 'owned');
    assert.equal(checkpoint!.context, browser.context);
    assert.equal(checkpoint!.selectedPage, browser.pages[1]);
    await restarted.run(['list']);
    assert.ok(restarted.output.some(text => text.includes('- owned:\n  - status: open')));
    await restarted.run(['close-all']);
    assert.equal(browser.releases, 1);
    assert.deepEqual(second.inspectSessions(), []);
  } finally { await second.dispose(); }
});

test('restored snapshot refs cannot collide with refs from the previous controller', async () => {
  const browser = retainedBrowser();
  const first = createPlaywrightController({ adapter: browser.adapter });
  const before = runner(first);
  await before.run(['open']);
  await before.run(['snapshot']);
  assert.ok(before.output.some(text => text.includes('e1')));
  const second = createPlaywrightController({ adapter: browser.adapter });
  await second.restoreSession({ name: 'default', async acquire() { return { lease: browser.lease, selectedPage: browser.pages[0] }; } });
  const after = runner(second);
  try {
    await after.run(['snapshot']);
    await assert.rejects(after.run(['click', 'e1']), /stale snapshot ref/);
    assert.equal(second.inspectSessions().length, 1);
  } finally { await second.dispose(); }
});

test('restoration rejects expired records before acquiring and invalid selections retire the acquired lease', async () => {
  const browser = retainedBrowser();
  const controller = createPlaywrightController({ adapter: browser.adapter });
  let acquisitions = 0;
  const acquire = async () => { acquisitions++; return { lease: browser.lease, selectedPage: {} as PlaywrightPage }; };
  await assert.rejects(controller.restoreSession({ name: 'expired', expiresAt: Date.now() - 1, acquire }), /expired/);
  assert.equal(acquisitions, 0);
  await assert.rejects(controller.restoreSession({ name: 'invalid', acquire }), /Selected tab/);
  assert.equal(acquisitions, 1);
  assert.equal(browser.releases, 1);
  await controller.dispose();
});

test('restore and open share name admission and public CLI exposes the same host lifecycle', async () => {
  const browser = retainedBrowser();
  const controller = createPlaywrightController({ adapter: browser.adapter });
  const restored = controller.restoreSession({ name: 'same', async acquire() { return { lease: browser.lease, selectedPage: browser.pages[1] }; } });
  const opened = runner(controller).run(['-s=same', 'open']);
  await restored;
  await opened;
  assert.equal(browser.createdPages, 1);
  assert.equal(browser.releases, 1);
  await controller.dispose();
  const cli = createPlaywrightCli({ adapter: browser.adapter });
  assert.equal(typeof cli.restoreSession, 'function');
  assert.equal(typeof cli.inspectSessions, 'function');
  await cli.dispose();
  await assert.rejects(cli.restoreSession({ name: 'after', async acquire() { throw new Error('must not acquire'); } }), /disposed/);
});
