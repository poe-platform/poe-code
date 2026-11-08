import assert from 'node:assert/strict';
import { test } from 'node:test';

const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright-core');
const root = process.env.SAFE_BASH_TEST_ROOT || new URL('../../dist/', import.meta.url).href;
const { createPlaywrightAdapter, createPlaywrightCli } = await import(new URL('commands/playwright/index.js', root));
const { Shell } = await import(new URL('shell/index.js', root));
const { MemoryFileSystem } = await import(new URL('fs/memory/index.js', root));

test('native snapshots reject oversized content before extraction and survive huge unrelated attributes', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  let context;
  let releases = 0;
  const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    return { browser: {
      isConnected: () => browser.isConnected(), on: browser.on.bind(browser), off: browser.off.bind(browser),
      async newContext() {
        context = await browser.newContext();
        await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<button>Save</button>' }));
        return context;
      },
    }, release: async () => { releases++; await browser.close(); } };
  } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(createPlaywrightCli({ adapter, limits: { maxSnapshotBytes: 1024 } }).plugin);
  const run = args => shell.exec(`playwright-cli ${args}`);
  try {
    assert.equal((await run('open https://example.test/')).exitCode, 0);
    const page = context.pages()[0];
    for (const field of ['body', 'aria-label', 'value', 'id', 'class', 'data-large']) {
      await page.evaluate(field => {
        const { document } = globalThis;
        document.body.innerHTML = '<button>Save</button>';
        const huge = 'X'.repeat(40 * 1024 * 1024);
        if (field === 'body') document.body.textContent = huge;
        else if (field === 'value') {
          const input = document.createElement('input'); input.value = huge; document.body.append(input);
        } else document.querySelector('button').setAttribute(field, huge);
      }, field);
      const result = await run('snapshot');
      if (['body', 'aria-label', 'value'].includes(field)) {
        assert.equal(result.exitCode, 1, field);
        assert.match(result.stderr, /Snapshot byte limit exceeded/, field);
        assert.equal(result.stdout, '');
      } else {
        assert.equal(result.exitCode, 0, `${field}: ${result.stderr}`);
        assert.ok(result.stdout.includes('Save'));
        assert.ok(result.stdout.length < 1024);
      }
      assert.equal((await run('goto https://example.test/recovery')).exitCode, 0);
      assert.equal((await run('snapshot')).exitCode, 0);
    }
    await page.evaluate(() => {
      const { document } = globalThis;
      document.body.innerHTML = '<button onclick="this.textContent=\'Clicked\'">Same</button><button>Same</button>';
    });
    const snapshot = await run('snapshot');
    const ref = snapshot.stdout.match(/\[ref=(e\d+)\]/)[1];
    await page.evaluate(() => globalThis.document.body.append(globalThis.document.querySelector('button')));
    assert.equal((await run(`click ${ref}`)).exitCode, 0);
    assert.deepEqual(await page.locator('button').allTextContents(), ['Same', 'Clicked']);
  } finally { await shell.dispose(); await browser.close(); }
  assert.equal(releases, 1);
});
