import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightAdapter } from '../../src/playwright/adapter.ts';
import { playwrightStandardAbilities } from '../../src/playwright/standard-capabilities.ts';
import { observePlaywrightCapabilities } from '../../src/playwright/capability-events.ts';
import { createPlaywrightController } from '../../src/playwright/controller.ts';

/* global window, document */

async function captureNativeArtifact(produce, options) {
  const directory = await mkdtemp(join(tmpdir(), 'safe-playwright-artifact-'));
  try {
    const filename = join(directory, `capture.${options.extension}`);
    await produce(filename);
    options.signal.throwIfAborted();
    assert.ok((await stat(filename)).size <= options.maxBytes);
    return await readFile(filename);
  } finally { await rm(directory, { recursive: true }); }
}

test('native Chromium storage, state replacement, actions, evaluation and PDF', {
  skip: !process.env.PLAYWRIGHT_TEST_MODULE && 'Set PLAYWRIGHT_TEST_MODULE to an installed native Playwright client', timeout: 30000,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_TEST_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE } : {}) });
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser, release: async () => {},
    captureArtifact: captureNativeArtifact,
  }) } });
  const signal = new AbortController().signal;
  const lease = await adapter.acquire({ acquisitionId: 'native', session: 'native', browser: 'chromium', headless: true, signal });
  const files = new Map();
  const observerCleanups = [];
  const observe = context => observePlaywrightCapabilities(context, close => observerCleanups.push(close), { maxCommandBytes: 1048576, maxArtifactBytes: 1048576 });
  observe(lease.context);
  const html = '<title>Capabilities</title><input id="text"><input id="check" type="checkbox"><select id="choice"><option value="one">One</option><option value="two">Two</option></select><button id="count" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>';
  const route = context => context.route('**/*', value => value.fulfill({ contentType: 'text/html', body: html }));
  await route(lease.context);
  let page = await lease.context.newPage();
  await page.goto('https://capabilities.test/app');
  const run = async (command, args = [], options = {}) => {
    const cleanups = [];
    try { return await playwrightStandardAbilities[command].execute({
      command, args, options, session: 'native', signal, limits: { maxCommandBytes: 1048576, maxArtifactBytes: 1048576 },
      browserSession: {
        context: lease.context, page, captureArtifact: lease.captureArtifact,
        resolveTarget: async target => { const handle = await page.locator(target).elementHandle(); assert.ok(handle); cleanups.push(() => handle.dispose()); return handle; },
        selectPage: async selected => { page = selected; }, registerCleanup() {},
        replaceContext: async state => { await lease.replaceContext(state); observe(lease.context); await route(lease.context); page = await lease.context.newPage(); await page.goto('https://capabilities.test/app'); },
      },
      write: async () => {}, readFile: async name => files.get(name), writeArtifact: async (bytes, name) => { files.set(name, bytes); }, registerCleanup: close => cleanups.push(close),
    }); } finally { for (const close of cleanups) await close(); }
  };
  try {
    await run('localstorage-set', ['token', 'first']);
    await run('sessionstorage-set', ['temporary', 'session']);
    await run('cookie-set', ['auth', 'cookie'], { httpOnly: true, secure: true });
    await run('state-save', ['/state.json']);
    const state = JSON.parse(new TextDecoder().decode(files.get('/state.json')));
    assert.equal(state.cookies[0].name, 'auth');
    assert.deepEqual(state.origins[0].localStorage, [{ name: 'token', value: 'first' }]);
    assert.equal(state.origins[0].indexedDB, undefined);
    await run('localstorage-set', ['unrelated', 'remove-me']);
    await run('cookie-set', ['unrelated', 'remove-me']);
    // Cloudflare 1.3.6 lacks setStorageState; exercise replacement explicitly.
    const nativeSetStorage = lease.context.setStorageState;
    lease.context.setStorageState = undefined;
    await run('state-load', ['/state.json']);
    if (lease.context.setStorageState === undefined) lease.context.setStorageState = nativeSetStorage;
    assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), { token: 'first' });
    assert.deepEqual((await lease.context.cookies()).map(cookie => cookie.name), ['auth']);
    assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), {});
    await page.locator('#text').focus();
    await run('type', ['hello']);
    await run('check', ['#check']);
    await run('select', ['#choice', 'two']);
    await run('dblclick', ['#count']);
    assert.equal(await page.locator('#text').inputValue(), 'hello');
    assert.equal(await page.locator('#check').isChecked(), true);
    assert.equal(await page.locator('#choice').inputValue(), 'two');
    assert.equal(await page.locator('#count').textContent(), '2');
    if (page.screencast) {
      assert.match(JSON.stringify(await run('video-show-actions', [], { duration: '1', cursor: 'none' })), /Action annotations enabled/);
      await run('hover', ['#count']);
      assert.match(JSON.stringify(await run('video-hide-actions')), /Action annotations disabled/);
    }
    assert.match(JSON.stringify(await run('eval', ['() => 6 * 7'])), /42/);
    assert.match(JSON.stringify(await run('eval', ['node => node.value', '#text'])), /hello/);
    await run('pdf', [], { filename: '/page.pdf' });
    assert.equal(new TextDecoder().decode(files.get('/page.pdf').slice(0, 5)), '%PDF-');
    assert.match(JSON.stringify(await run('localstorage-list')), /token=first/);
    await page.evaluate(async () => { console.log('observed message'); await fetch('/api', { method: 'POST', body: 'observed body' }); });
    assert.match(JSON.stringify(await run('console')), /observed message/);
    assert.match(JSON.stringify(await run('requests')), /POST.*capabilities.test\/api/);
    assert.match(JSON.stringify(await run('requests', [], { filter: 'api$' })), /POST.*capabilities.test\/api/);
    assert.match(JSON.stringify(await run('request-body', ['2'])), /observed body/);
    assert.match(JSON.stringify(await run('response-body', ['2'])), /Capabilities/);
    await run('recording-start');
    const bounds = await page.locator('#count').boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForTimeout(500);
    assert.match(JSON.stringify(await run('recording-stop')), /Recorded actions[\s\S]*click/);
    await run('tracing-start');
    await run('eval', ['() => document.title']);
    await run('tracing-stop');
    const trace = [...files.entries()].find(([name]) => name.endsWith('.zip'));
    assert.ok(trace);
    assert.deepEqual([...trace[1].slice(0, 2)], [80, 75]);
  } finally { for (const close of observerCleanups) await close(); await lease.release(); await browser.close(); }
});

test('native Chromium modal commands, virtual binary uploads and external drops', {
  skip: !process.env.PLAYWRIGHT_TEST_MODULE && 'Set PLAYWRIGHT_TEST_MODULE to an installed native Playwright client', timeout: 30000,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_TEST_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_TEST_EXECUTABLE } : {}) });
  const createContext = browser.newContext.bind(browser);
  let context;
  browser.newContext = async options => {
    context = await createContext(options);
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<title>Modal capabilities</title>
      <button id="confirm" onclick="window.confirmed=confirm('Continue?')">Confirm</button>
      <button id="prompt" onclick="window.answer=prompt('Your answer?')">Prompt</button>
      <input id="upload" type="file" multiple>
      <div id="drop" ondragover="event.preventDefault()" ondrop="event.preventDefault();window.dropped={text:event.dataTransfer.getData('text/plain'),files:Array.from(event.dataTransfer.files).map(f=>({name:f.name,size:f.size,type:f.type}))}">Drop here</div>` }));
    return context;
  };
  const adapter = createPlaywrightAdapter({ chromium: { acquireBrowser: async () => ({ browser, prepareFileBytes: bytes => Buffer.from(bytes), captureArtifact: captureNativeArtifact, release: async () => {} }) } });
  const controller = createPlaywrightController({ adapter });
  const files = new Map([['/virtual/input.txt', Uint8Array.of(0, 255, 1, 10)]]);
  const run = async (...args) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, write: async text => { output += text; }, writeArtifact: async (bytes, name) => { files.set(name, bytes); }, readArtifact: async path => {
      const bytes = files.get(path);
      if (!bytes) throw Object.assign(new Error('Missing virtual file'), { code: 'ENOENT' });
      return bytes;
    } });
    return output;
  };
  try {
    await run('open', 'https://capabilities.test/modal');
    const page = context.pages()[0];
    assert.match(await run('click', '#confirm'), /Modal state[\s\S]*Continue\?/);
    await run('dialog-dismiss');
    assert.equal(await page.evaluate(() => window.confirmed), false);
    assert.match(await run('click', '#prompt'), /Modal state[\s\S]*Your answer/);
    await run('dialog-accept', 'accepted text');
    assert.equal(await page.evaluate(() => window.answer), 'accepted text');
    assert.match(await run('eval', '() => { window.evaluated = prompt("Evaluate prompt"); }'), /Modal state/);
    await run('dialog-accept', 'evaluation answer');
    assert.equal(await page.evaluate(() => window.evaluated), 'evaluation answer');
    const uploadOutput = await run('click', '#upload');
    assert.match(uploadOutput, /Modal state[\s\S]*file chooser/i);
    await run('upload', '/virtual/input.txt');
    assert.deepEqual(await page.locator('#upload').evaluate(async input => ({ name: input.files[0].name, type: input.files[0].type, bytes: Array.from(new Uint8Array(await input.files[0].arrayBuffer())) })), { name: 'input.txt', type: 'text/plain', bytes: [0, 255, 1, 10] });
    await run('drop', '#drop', '--path', '/virtual/input.txt', '--data', 'text/plain=external value');
    assert.deepEqual(await page.evaluate(() => window.dropped), { text: 'external value', files: [{ name: 'input.txt', size: 4, type: 'text/plain' }] });
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'download'; link.textContent = 'Download'; link.download = 'evidence.bin';
      link.href = URL.createObjectURL(new Blob([Uint8Array.of(9, 8, 0, 255)]));
      document.body.append(link);
    });
    assert.match(await run('click', '#download'), /Events[\s\S]*Downloaded file[\s\S]*evidence\.bin/);
    const download = [...files.entries()].find(([name]) => name.endsWith('-evidence.bin'));
    assert.ok(download);
    assert.deepEqual([...download[1]], [9, 8, 0, 255]);
    assert.match(await run('webmcp-list'), /No WebMCP tools registered/);
    await page.evaluate(() => {
      Object.defineProperty(document, 'modelContext', { configurable: true, value: {
        getTools() { return [{ name: 'echo', description: 'Echo parameters', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
        invokeTool(name, params) { return { name, value: params.value }; },
      } });
    });
    assert.match(await run('webmcp-list'), /echo \[readOnly\]: Echo parameters/);
    assert.match(await run('webmcp-call', 'echo', '--params', '{"value":"native answer"}'), /native answer/);
    await assert.rejects(run('webmcp-call', 'echo', '--params', '[]'), /JSON object/);
    assert.match(await run('webmcp-call', 'echo', '--params', '{"value":"still active"}'), /still active/);
    await page.evaluate(() => { const child = document.createElement('iframe'); child.srcdoc = '<title>Child tools</title>'; document.body.append(child); });
    const child = page.frames().find(frame => frame !== page.mainFrame());
    await child.waitForLoadState();
    await child.evaluate(() => {
      Object.defineProperty(document, 'modelContext', { value: {
        getTools() { return [{ name: 'echo', description: 'Child echo' }]; },
        invokeTool() { return 'child answer'; },
      } });
    });
    assert.match(await run('webmcp-call', 'echo', '--frame', child.url()), /child answer/);
    await assert.rejects(run('webmcp-call', 'echo'), /multiple frames/);
  } finally { await controller.dispose(); await browser.close(); }
});
