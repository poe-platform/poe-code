import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightAdapter } from '../../src/playwright/adapter.ts';
import { createPlaywrightController } from '../../src/playwright/controller.ts';

test('native snapshot hierarchy, searchable actionable refs and generated Playwright locators', {
  skip: !process.env.PLAYWRIGHT_TEST_MODULE && 'Set PLAYWRIGHT_TEST_MODULE to an installed native Playwright client', timeout: 30000,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE);
  const generateActionCode = process.env.PLAYWRIGHT_TEST_CODEGEN_MODULE ? (await import(process.env.PLAYWRIGHT_TEST_CODEGEN_MODULE)).generateBrowserActionCode : undefined;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_TEST_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE } : {}) });
  const nativeContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await nativeContext(options);
    // Qualify the replacement path used by Cloudflare's older native client.
    context.setStorageState = undefined;
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Account</h1><section aria-label="Actions"><button id="save" data-qa="save-action" onclick="this.textContent=\'Saved\'">Save</button></section></main>' }));
    return context;
  };
  const controller = createPlaywrightController({ adapter: createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser, release: async () => {},
    ...(generateActionCode ? { generateActionCode } : {}),
    // This integration oracle only executes the fixed, trusted init fixture below.
    executeCode: async ({ page, source }) => { await new Function(`return (${source});`)()(page); },
  }) } }) });
  const run = async (...args) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; }, async writeArtifact() {},
      async readArtifact(filename) {
        if (filename === '.playwright/cli.config.json') throw Object.assign(new Error('missing config'), { code: 'ENOENT' });
        if (filename === 'browser.json') return new TextEncoder().encode(JSON.stringify({ browser: { initScript: ['first.js', 'second.js'], initPage: ['page.js'] }, testIdAttribute: 'data-qa', network: { allowedOrigins: ['https://snapshot.test'] }, timeouts: { settle: 0 } }));
        if (['python.json', 'java.json', 'csharp.json', 'none.json'].includes(filename)) return new TextEncoder().encode(JSON.stringify({ codegen: filename.split('.')[0], timeouts: { settle: 0 } }));
        if (filename === 'first.js') return new TextEncoder().encode('globalThis.initOrder = [1];');
        if (filename === 'second.js') return new TextEncoder().encode('globalThis.initOrder.push(2);');
        if (filename === 'page.js') return new TextEncoder().encode('export default async ({ page }) => { await page.addInitScript(() => { globalThis.pageInitialized = true; }); };');
        return new TextEncoder().encode(JSON.stringify({ cookies: [], origins: [] }));
      },
    });
    return output;
  };
  try {
    await run('open', 'https://snapshot.test', '--config=browser.json', '--mobile');
    const initialPage = browser.contexts()[0].pages()[0];
    assert.deepEqual(await initialPage.evaluate(() => globalThis.initOrder), [1, 2]);
    assert.equal(await initialPage.evaluate(() => globalThis.pageInitialized), true);
    assert.equal(await initialPage.evaluate(async () => { try { await fetch('https://blocked.test'); return 'allowed'; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(initialPage.viewportSize().width, 360);
    assert.equal(await initialPage.evaluate(() => globalThis.navigator.maxTouchPoints), 1);
    const config = JSON.parse((await run('--raw', 'config-print')).trim());
    assert.equal(config.browser.browserName, 'chromium');
    assert.equal(config.browser.contextOptions.isMobile, true);
    assert.equal(config.timeouts.settle, 0);
    const snapshot = await run('snapshot');
    assert.match(snapshot, /- main[\s\S]*\n {2}- heading "Account"[\s\S]*\n {2}- region "Actions"[\s\S]*\n {4}- button "Save"/);
    const structured = JSON.parse(await run('snapshot', '--json')).snapshot;
    const stripRefs = nodes => nodes.map(({ ref, children, ...node }) => ({ ...node, ...(children ? { children: stripRefs(children) } : {}) }));
    assert.deepEqual(stripRefs(structured), stripRefs(await initialPage.ariaSnapshotJSON({ mode: 'ai' })));
    const partialJSON = JSON.parse(await run('snapshot', 'section', '--json', '--depth=1', '--boxes')).snapshot;
    assert.equal(partialJSON[0].role, 'region');
    assert.equal(partialJSON[0].children[0].role, 'button');
    assert.ok(partialJSON[0].box.width > 0);
    const snapshotFile = JSON.parse(await run('snapshot', '--json', '--filename=explicit.yml')).snapshot;
    assert.deepEqual(snapshotFile, { file: 'explicit.yml' });
    const page = browser.contexts()[0].pages()[0];
    // Qualify the old client's whole-page-only native snapshot interface.
    const ariaSnapshot = page.ariaSnapshot.bind(page);
    page._snapshotForAI = async () => ({ full: await ariaSnapshot({ mode: 'ai' }) });
    page.ariaSnapshot = undefined;
    const partial = await run('snapshot', 'section', '--boxes', '--depth=1');
    assert.match(partial, /- region "Actions".*\[box=\d+,\d+,\d+,\d+\]:\n {2}- button "Save"/);
    assert.doesNotMatch(partial, /heading "Account"/);
    assert.doesNotMatch(await run('snapshot', '--depth=1'), /button "Save"/);
    const found = await run('find', 'Save');
    const reference = found.match(/button "Save" \[ref=(e\d+)\]/)?.[1];
    assert.ok(reference);
    assert.equal((await run('--raw', 'generate-locator', reference)).trim(), "getByRole('button', { name: 'Save' })");
    assert.equal((await run('--raw', 'generate-locator', '#save')).trim(), "locator('#save')");
    assert.equal((await run('--raw', 'generate-locator', "getByTestId('save-action')")).trim(), "getByTestId('save-action')");
    assert.equal((await run('--raw', 'generate-locator', "getByRole('button', { name: 'Save' })")).trim(), "getByRole('button', { name: 'Save' })");
    assert.equal((await run('--raw', 'generate-locator', "getByRole('region', { name: 'Actions' }).getByRole('button', { name: /Save/i })")).trim(), "getByRole('region', { name: 'Actions' }).getByRole('button', { name: /Save/i })");
    await assert.rejects(run('click', "getByRole('button'); globalThis.untrustedHostCode = true"), /Invalid Playwright locator/);
    await assert.rejects(run('click', "locator('aria-ref=e1')"), /issued snapshot reference/);
    // Cloudflare 1.58 has no persistent hideHighlight API.
    page.hideHighlight = undefined;
    assert.match(await run('highlight', reference, '--style', 'outline: 3px dashed red'), /Highlighted getByRole/);
    assert.equal(await page.evaluate(() => globalThis.document.querySelectorAll('div[aria-hidden="true"]').length), 1);
    await run('highlight', '--hide');
    assert.equal(await page.evaluate(() => globalThis.document.querySelectorAll('div[aria-hidden="true"]').length), 0);
    const clicked = await run('click', reference);
    assert.match(clicked, /await page\.getByRole\('button', \{ name: 'Save' \}\)\.click\(\);/);
    assert.match(await run('snapshot'), /button "Saved"/);
    const elementScreenshot = await run('screenshot', '#save');
    assert.match(elementScreenshot, /Screenshot of element/);
    assert.match(elementScreenshot, /await page\.locator\('#save'\)\.screenshot\(/);
    await assert.rejects(run('click', reference), /stale/);
    await assert.rejects(run('click', 'aria-ref=e1'), /issued snapshot reference/);
    await run('route', '**/mocked', '--body', 'persisted route');
    await run('state-load', '/virtual/state.json');
    assert.deepEqual(await browser.contexts()[0].pages()[0].evaluate(() => globalThis.initOrder), [1, 2]);
    assert.equal(await browser.contexts()[0].pages()[0].evaluate(() => globalThis.pageInitialized), true);
    assert.match(await run('route-list'), /mocked/);
    assert.match(await run('eval', 'async () => await (await fetch("/mocked")).text()'), /persisted route/);
    const restoredPage = browser.contexts()[0].pages()[0];
    restoredPage.hideHighlight = undefined;
    await restoredPage.evaluate(() => {
      const frame = globalThis.document.createElement('iframe');
      frame.srcdoc = '<button>Child</button>';
      globalThis.document.body.appendChild(frame);
    });
    await restoredPage.frameLocator('iframe').getByRole('button').waitFor();
    assert.equal((await run('--raw', 'generate-locator', "frameLocator('iframe').getByRole('button', { name: 'Child' })")).trim(), "locator('iframe').contentFrame().getByRole('button', { name: 'Child' })");
    await run('highlight', 'iframe >> internal:control=enter-frame >> button');
    assert.equal(await restoredPage.frames()[1].evaluate(() => globalThis.document.querySelectorAll('div[aria-hidden="true"]').length), 1);
    await run('highlight', '--hide');
    assert.equal(await restoredPage.frames()[1].evaluate(() => globalThis.document.querySelectorAll('div[aria-hidden="true"]').length), 0);
    if (generateActionCode) for (const [language, call] of [['python', 'get_by_role("button", name="Save").click()'], ['java', 'getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save")).click()'], ['csharp', 'GetByRole(AriaRole.Button, new() { Name = "Save" }).ClickAsync()']]) {
      await run('open', 'https://snapshot.test', `--config=${language}.json`);
      assert.equal((await run('--raw', 'generate-locator', '#save')).trim(), "locator('#save')");
      const output = await run('click', "getByRole('button', { name: 'Save' })");
      assert.ok(output.includes('```' + language), output);
      assert.ok(output.includes(call), output);
      assert.doesNotMatch(output, /\.getByRole\('button'/);
      const hovered = await run('hover', '#save');
      assert.ok(hovered.includes(language === 'csharp' ? '.HoverAsync()' : '.hover()'), hovered);
    }
    assert.doesNotMatch(await run('open', 'https://snapshot.test', '--config=none.json'), /Ran Playwright code/);
    assert.doesNotMatch(await run('click', '#save'), /Ran Playwright code/);
  } finally { await controller.dispose(); await browser.close(); }
});
