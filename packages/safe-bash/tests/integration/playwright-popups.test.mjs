import assert from 'node:assert/strict';
import { test } from 'node:test';

const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright-core');
const root = process.env.SAFE_BASH_TEST_ROOT || new URL('../../dist/', import.meta.url).href;
const { createPlaywrightAdapter, createPlaywrightCli } = await import(new URL('commands/playwright/index.js', root));
const { Shell } = await import(new URL('shell/index.js', root));
const { MemoryFileSystem } = await import(new URL('fs/memory/index.js', root));

for (const delayed of [false, true]) test(`native popup overflow ${delayed ? 'between commands' : 'during click'} retires only its session`, { timeout: 15000 }, async () => {
  const contexts = [];
  const releases = [];
  const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    const browser = await chromium.launch();
    const index = contexts.length;
    releases[index] = 0;
    return { browser: {
      isConnected: () => browser.isConnected(), on: browser.on.bind(browser), off: browser.off.bind(browser),
      async newContext() {
        const context = await browser.newContext();
        contexts.push(context);
        await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
          '<button onclick="window.open(\'about:blank\');window.open(\'about:blank\')">Open popups</button>' }));
        return context;
      },
    }, release: async () => { releases[index]++; await browser.close(); } };
  } } });
  const cli = createPlaywrightCli({ adapter, limits: { maxTabs: 2 } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
  const run = (session, args) => shell.exec(`playwright-cli -s=${session} ${args}`);
  try {
    assert.equal((await run('victim', 'open https://example.test/')).exitCode, 0);
    assert.equal((await run('spare', 'open')).exitCode, 0);
    const victim = contexts[0];
    const page = victim.pages()[0];
    for (let attempt = 0; attempt < 2; attempt++) {
      const popup = victim.waitForEvent('page');
      await page.evaluate(() => { globalThis.open('about:blank'); });
      const created = await popup;
      assert.equal((await run('victim', 'tab-list')).stdout.trim().split('\n').length, 2);
      assert.equal(releases[0], 0);
      if (attempt === 0) await created.close();
    }
    await run('victim', 'snapshot');
    const closed = victim.waitForEvent('close', { timeout: 5000 });
    if (delayed) await page.evaluate(() => { setTimeout(() => globalThis.open('about:blank'), 50); });
    else await run('victim', 'click e1');
    await closed;
    assert.equal((await run('victim', 'tab-list')).exitCode, 1);
    assert.equal((await run('spare', 'tab-list')).exitCode, 0);
    assert.equal(releases[1], 0);
    assert.equal((await run('victim', 'open')).exitCode, 0);
    assert.equal(releases[0], 1);
    assert.equal((await run('victim', 'tab-list')).exitCode, 0);
  } finally { await shell.dispose(); }
  assert.deepEqual(releases, [1, 1, 1]);
});
