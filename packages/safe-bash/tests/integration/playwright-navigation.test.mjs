import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright-core');
const root = process.env.SAFE_BASH_TEST_ROOT || new URL('../../dist/', import.meta.url).href;
const { createPlaywrightAdapter, createPlaywrightController } = await import(new URL('playwright/index.js', root));
const { createPlaywrightCli } = await import(new URL('commands/playwright/index.js', root));
const { Shell } = await import(new URL('shell/index.js', root));
const { MemoryFileSystem } = await import(new URL('fs/memory/index.js', root));

for (const interfaceName of ['controller', 'cli']) {
  test(`${interfaceName}: form navigation retains its action handle and session`, { timeout: 15000 }, async () => {
    const server = await chromium.launchServer({ headless: true });
    const browser = await chromium.connect(server.wsEndpoint());
    const held = Promise.withResolvers();
    const committed = Promise.withResolvers();
    const submitted = Promise.withResolvers();
    const response = Promise.withResolvers();
    let releases = 0;
    const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
      return { browser: {
        isConnected: () => browser.isConnected(), on: browser.on.bind(browser), off: browser.off.bind(browser),
        async newContext() {
          const context = await browser.newContext();
          await context.route('**/*', async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/save') { submitted.resolve(); await response.promise; }
            if (path === '/hold') {
              committed.resolve();
              await held.promise;
              await route.fulfill({ body: '', contentType: 'image/png' }).catch(() => {});
            } else await route.fulfill({ contentType: 'text/html', body: path === '/save'
              ? '<h1>Saved</h1><img src="/hold"><button>Continue</button>'
              : '<form action="/save" method="post"><label>Name<input name="name"></label><button>Save</button></form>' });
          });
          return context;
        },
      }, release: async () => { releases++; held.resolve(); await browser.close(); } };
    } } });
    const controller = createPlaywrightController({ adapter, limits: { actionTimeoutMs: 5000 } });
    const cli = createPlaywrightCli({ adapter, limits: { actionTimeoutMs: 5000 } });
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(cli.plugin);
    const run = async args => {
      if (interfaceName === 'cli') {
        const result = await shell.exec(`playwright-cli -s=research ${args.join(' ')}`);
        assert.equal(result.exitCode, 0, result.stderr);
        return result.stdout;
      }
      let output = '';
      await controller.run({ args: ['-s=research', ...args], env: {}, signal: AbortSignal.timeout(10000),
        write: async text => { output += text; }, writeArtifact: async (bytes, filename) => fs.writeFile(filename, bytes) });
      return output;
    };
    try {
      await run(['open', 'https://example.test/']);
      assert.ok((await run(['snapshot'])).includes('Save" [ref=e2]'));
      await run(['fill', 'e1', 'Ada']);
      let settled = false;
      const click = run(['click', 'e2']).then(() => { settled = true; }, error => { settled = true; throw error; });
      void click.catch(() => {});
      await Promise.race([submitted.promise, click]);
      await setTimeout(50);
      const settledBeforeCommit = settled;
      response.resolve();
      await Promise.race([committed.promise, click]);
      held.resolve();
      await click;
      assert.equal(settledBeforeCommit, false, 'click must retain normal navigation waiting');
      assert.equal(releases, 0);
      const snapshot = await run(['snapshot']);
      assert.ok(snapshot.includes('Saved'));
      assert.ok(snapshot.includes('Continue" [ref=e3]'));
      await run(['screenshot', '--filename=/saved.png']);
      const png = await fs.readFile('/saved.png');
      assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      await run(['click', 'e3']);
    } finally {
      held.resolve();
      response.resolve();
      await Promise.allSettled([controller.dispose(), shell.dispose()]);
      await browser.close();
      await server.close();
    }
    assert.equal(releases, 1);
  });
}
