import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController } from '../../src/playwright/controller.ts';

for (const native of [true, false]) test(`snapshot document identity survives iframe navigation (native=${native})`, {
  skip: !process.env.PLAYWRIGHT_TEST_MODULE && 'Set PLAYWRIGHT_TEST_MODULE to a native Playwright client', timeout: 30000,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_TEST_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('/child')
    ? '<input aria-label="Child">' : '<input aria-label="Email"><iframe src="/child"></iframe>' }));
  const page = await context.newPage();
  context.newPage = async () => page;
  if (!native) { page.ariaSnapshot = undefined; page._snapshotForAI = undefined; }
  const lease = { context, onClosed() { return () => {}; }, async release() {} };
  let controller = createPlaywrightController({ adapter: { browsers: { chromium: { headed: false } }, async acquire() { return lease; } } });
  const run = async (...args) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; }, async writeArtifact() {} });
    return output;
  };
  const ref = (snapshot, name) => {
    const value = snapshot.match(new RegExp(`textbox "${name}".*?\\[ref=(e\\d+)\\]`))?.[1];
    assert.ok(value, snapshot);
    return value;
  };
  try {
    await run('open', 'https://snapshot.test/');
    await page.frameLocator('iframe').getByRole('textbox').waitFor();
    const snapshot = await run('snapshot');
    const email = ref(snapshot, 'Email');
    const child = ref(snapshot, 'Child');
    const original = await page.getByRole('textbox', { name: 'Email' }).elementHandle();
    const childFrame = page.frames()[1];
    await childFrame.goto('https://snapshot.test/child-next');
    assert.equal(page.url(), 'https://snapshot.test/');
    assert.equal(await original.evaluate(node => node.isConnected), true);
    await run('fill', email, 'preserved');
    assert.equal(await original.inputValue(), 'preserved');
    await assert.rejects(run('fill', child, 'wrong document'));
    assert.equal(await childFrame.getByRole('textbox').inputValue(), '');
    await page.getByRole('textbox', { name: 'Email' }).evaluate(node => node.replaceWith(node.cloneNode()));
    await assert.rejects(run('fill', email, 'replacement'));
    assert.equal(await page.getByRole('textbox', { name: 'Email' }).inputValue(), 'preserved');
    const replaced = ref(await run('snapshot'), 'Email');
    await run('snapshot');
    await assert.rejects(run('fill', replaced, 'old snapshot'), /stale/);
    const beforeNavigation = ref(await run('snapshot'), 'Email');
    await page.goto('https://snapshot.test/next');
    await assert.rejects(run('fill', beforeNavigation, 'old document'), /stale/);
    const beforeRestore = ref(await run('snapshot'), 'Email');
    await controller.dispose();
    controller = createPlaywrightController({ adapter: { browsers: { chromium: { headed: false } }, async acquire() { return lease; } } });
    await controller.restoreSession({ name: 'default', async acquire() { return { lease, selectedPage: page }; } });
    await assert.rejects(run('fill', beforeRestore, 'cold restore'), /stale/);
    assert.equal(await page.getByRole('textbox', { name: 'Email' }).inputValue(), '');
    await original.dispose();
  } finally { await controller.dispose(); await browser.close(); }
});
