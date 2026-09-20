import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePlaywrightOpenOptions } from '../../src/playwright/open-options.js';
import type { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { playwrightInitPageSource } from '../../src/playwright/session-runtime.js';
import { runInNewContext } from 'node:vm';
import { parsePlaywrightIniConfig } from '../../src/playwright/config-ini.js';

test('INI configuration matches native longhand types, arrays, comments and quoted values', () => {
  const parsed = parsePlaywrightIniConfig(`; native longhand configuration
browser.browserName=chromium
browser.launchOptions.headless=1
browser.contextOptions.viewport=360x732
browser.contextOptions.screen=360x808
browser.contextOptions.deviceScaleFactor=3
browser.contextOptions.isMobile=true
browser.contextOptions.locale="007"
browser.initScript[]=first.js
browser.initScript[]=second.js
network.allowedOrigins[]=https://one.example
network.allowedOrigins[]=https://two.example
console.level=warning # comment
outputDir='reports # retained'
testIdAttribute=data\\;test
timeouts.action=1500
timeouts.navigation=60000
snapshot.boxes=false
customNumber="12"
customFlag
customNull=null
`);
  assert.deepEqual(parsed, {
    browser: { browserName: 'chromium', launchOptions: { headless: true }, contextOptions: { viewport: { width: 360, height: 732 }, screen: { width: 360, height: 808 }, deviceScaleFactor: 3, isMobile: true, locale: '007' }, initScript: ['first.js', 'second.js'] },
    network: { allowedOrigins: ['https://one.example', 'https://two.example'] }, console: { level: 'warning' }, outputDir: 'reports # retained', testIdAttribute: 'data;test',
    timeouts: { action: 1500, navigation: 60000 }, snapshot: { boxes: false }, customNumber: 12, customFlag: true, customNull: null,
  });
});

test('INI sections preserve native nested coercion and duplicate assignment semantics', () => {
  assert.deepEqual(parsePlaywrightIniConfig('outputDir=first\noutputDir=second\n[browser.contextOptions]\nviewport=360x732\nisMobile=true\n[console]\nlevel=error'), {
    outputDir: 'second', browser: { contextOptions: { viewport: '360x732', isMobile: true } }, console: { level: 'error' },
  });
  assert.deepEqual(parsePlaywrightIniConfig('browser.initScript=first.js\nbrowser.initScript[]=second.js\nbrowser.initScript=third.js'), { browser: { initScript: ['first.js', 'second.js', 'third.js'] } });
  assert.deepEqual(parsePlaywrightIniConfig('browser.contextOptions.viewport=bad\noutputDir=\nbrowser.contextOptions.hasTouch=0'), { browser: { contextOptions: { viewport: undefined, hasTouch: false } }, outputDir: '' });
});

test('INI rejects unsafe object paths and bounds input before parsing', () => {
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'browser.__proto__.polluted']) assert.throws(() => parsePlaywrightIniConfig(`${path}=yes`), /Invalid INI/);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.throws(() => parsePlaywrightIniConfig('x'.repeat(8 * 1024 * 1024 + 1)), /byte limit/);
});

const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: false } }, devices: {
  'Pixel 7': { userAgent: 'mobile-agent', viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, defaultBrowserType: 'chromium' },
}, async acquire() { throw new Error('must not acquire during config validation'); } };
const signal = new AbortController().signal;
const invocation = { args: [], env: {}, signal, async write() {} };

test('open resolves native device context options, standard defaults, and explicit idle override', async () => {
  const resolved = await resolvePlaywrightOpenOptions({ device: 'Pixel 7', 'idle-timeout': '0' }, invocation, adapter, 4096);
  assert.deepEqual(resolved, { browser: 'chromium', headless: true, idleTimeoutMs: 0, contextOptions: {
    userAgent: 'mobile-agent', viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true,
  } });
  assert.equal((await resolvePlaywrightOpenOptions({}, invocation, adapter, 4096)).idleTimeoutMs, 3_600_000);
  await assert.rejects(resolvePlaywrightOpenOptions({ mobile: true, device: 'Pixel 7' }, invocation, adapter, 4096), /Cannot use --mobile together/);
  await assert.rejects(resolvePlaywrightOpenOptions({ mobile: true }, invocation, adapter, 4096), /Unknown device: Pixel 10/);
});

test('open reads default config and config-relative storage state through bounded VFS', async () => {
  const paths: string[] = [];
  const files = new Map([
    ['.playwright/cli.config.json', JSON.stringify({ browser: { contextOptions: { locale: 'pl-PL', storageState: 'state.json', javaScriptEnabled: true } }, timeouts: { idle: 1500 } })],
    ['.playwright/state.json', JSON.stringify({ cookies: [], origins: [] })],
  ]);
  const resolved = await resolvePlaywrightOpenOptions({}, { ...invocation, async readArtifact(path, maxBytes) {
    paths.push(path); assert.equal(maxBytes, 4096); return new TextEncoder().encode(files.get(path)!);
  } }, adapter, 4096);
  assert.deepEqual(paths, ['.playwright/cli.config.json', '.playwright/state.json']);
  assert.equal(resolved.contextOptions.javaScriptEnabled, true);
  assert.equal(resolved.contextOptions.locale, 'pl-PL');
  assert.deepEqual(resolved.contextOptions.storageState, { cookies: [], origins: [] });
  assert.equal(resolved.idleTimeoutMs, 1500);
});

test('open ignores only missing implicit config and refuses unsupported launch controls and native paths', async () => {
  const missing = { ...invocation, async readArtifact() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } };
  await resolvePlaywrightOpenOptions({}, missing, adapter, 4096);
  await assert.rejects(resolvePlaywrightOpenOptions({ config: 'missing.json' }, missing, adapter, 4096), /missing/);
  for (const options of [{ persistent: true }, { profile: '/tmp/profile' }, { 'idle-timeout': '-1' }]) {
    await assert.rejects(resolvePlaywrightOpenOptions(options, invocation, adapter, 4096));
  }
  for (const config of [
    { browser: { launchOptions: { executablePath: '/bin/browser' } } },
    { browser: { contextOptions: { recordHar: { path: '/tmp/log' } } } },
    { browser: { contextOptions: { serviceWorkers: 'allow' } } },
  ]) await assert.rejects(resolvePlaywrightOpenOptions({}, { ...invocation, async readArtifact() { return new TextEncoder().encode(JSON.stringify(config)); } }, adapter, 4096), /Unsupported/);
});

test('open loads ordered init scripts and preserves native action/navigation/settle timeouts', async () => {
  const read: string[] = [];
  const result = await resolvePlaywrightOpenOptions({ config: 'config/browser.json' }, { ...invocation, async readArtifact(path) {
    read.push(path);
    const value = path.endsWith('.json') ? JSON.stringify({ browser: { initScript: ['first.js', 'second.js'] }, timeouts: { action: 1500, navigation: 3000, settle: 0 } }) : `globalThis.order = ${JSON.stringify(path)};`;
    return new TextEncoder().encode(value);
  } }, adapter, 4096);
  assert.deepEqual(read, ['config/browser.json', 'config/first.js', 'config/second.js']);
  assert.deepEqual(result.configuration, { configFile: 'config/browser.json', timeouts: { action: 1500, navigation: 3000, settle: 0 }, initScriptFiles: ['config/first.js', 'config/second.js'], initScripts: ['globalThis.order = "config/first.js";', 'globalThis.order = "config/second.js";'] });
});

test('standard config environment overrides files and CLI overrides the environment', async () => {
  const paths: string[] = [];
  const input = { ...invocation, env: { PLAYWRIGHT_MCP_CONFIG: 'env/browser.json', PLAYWRIGHT_MCP_DEVICE: 'Pixel 7', PLAYWRIGHT_MCP_USER_AGENT: 'environment-agent', PLAYWRIGHT_MCP_IDLE_TIMEOUT: '50', PLAYWRIGHT_MCP_TIMEOUT_ACTION: '250' },
    workspace: { cwd: '/work', async mkdir() {}, async exists() { return false; } },
    async readArtifact(path: string) { paths.push(path); return new TextEncoder().encode(JSON.stringify({ browser: { contextOptions: { userAgent: 'file-agent', locale: 'pl-PL' } }, timeouts: { action: 10, idle: 20 } })); },
  };
  const env = await resolvePlaywrightOpenOptions({}, input, adapter, 4096);
  assert.deepEqual(paths, ['env/browser.json']);
  assert.equal(env.contextOptions.userAgent, 'environment-agent');
  assert.equal(env.contextOptions.isMobile, true);
  assert.equal(env.idleTimeoutMs, 50);
  assert.equal(env.configuration?.timeouts?.action, 250);
  const cli = await resolvePlaywrightOpenOptions({ config: 'cli/browser.json', device: 'Pixel 7', 'idle-timeout': '0' }, input, adapter, 4096);
  assert.equal(paths.at(-1), 'cli/browser.json');
  assert.equal(cli.contextOptions.userAgent, 'mobile-agent');
  assert.equal(cli.idleTimeoutMs, 0);
  await resolvePlaywrightOpenOptions({}, { ...input, workspace: { ...input.workspace, async exists() { return true; } } }, adapter, 4096);
  assert.equal(paths.at(-1), '.playwright/cli.config.json');
});

test('global VFS config merges below local config and retains its resource path origin', async () => {
  const files = new Map([
    ['/home/agent/.playwright/cli.config.json', JSON.stringify({ browser: { contextOptions: { locale: 'en-US', storageState: 'state.json' } } })],
    ['.playwright/cli.config.json', JSON.stringify({ browser: { contextOptions: { locale: 'pl-PL' } } })],
    ['/home/agent/.playwright/state.json', JSON.stringify({ cookies: [], origins: [] })],
  ]);
  const result = await resolvePlaywrightOpenOptions({}, { ...invocation,
    workspace: { cwd: '/work', home: '/home/agent', async mkdir() {}, async exists() { return false; } },
    async readArtifact(path) { assert.ok(files.has(path), path); return new TextEncoder().encode(files.get(path)); },
  }, adapter, 4096);
  assert.equal(result.contextOptions.locale, 'pl-PL');
  assert.deepEqual(result.contextOptions.storageState, { cookies: [], origins: [] });
});

test('standard configuration resolves session features and config-relative page modules', async () => {
  const config = { browser: { initPage: ['page.js'] }, testIdAttribute: 'data-qa',
    network: { allowedOrigins: ['https://example.com'], blockedOrigins: ['private.example.com'] }, console: { level: 'warning' },
    snapshot: { mode: 'none', boxes: true }, outputDir: 'artifacts', outputMaxSize: 4096, timeouts: { expect: 1200 } };
  const result = await resolvePlaywrightOpenOptions({ config: 'config/browser.json' }, { ...invocation, async readArtifact(path) {
    assert.ok(['config/browser.json', 'config/page.js'].includes(path));
    return new TextEncoder().encode(path.endsWith('.json') ? JSON.stringify(config) : 'export default async ({ page }) => { await page.goto("https://example.com"); };');
  } }, adapter, 4096);
  assert.equal(result.configuration?.testIdAttribute, 'data-qa');
  assert.deepEqual(result.configuration?.network, config.network);
  assert.deepEqual(result.configuration?.console, config.console);
  assert.deepEqual(result.configuration?.snapshot, { mode: 'full', boxes: true });
  assert.equal(result.configuration?.outputDir, 'config/artifacts');
  assert.equal(result.configuration?.outputMaxSize, 4096);
  assert.equal(result.configuration?.timeouts?.expect, 1200);
  assert.deepEqual(result.configuration?.initPages, [{ filename: 'config/page.js', source: 'export default async ({ page }) => { await page.goto("https://example.com"); };' }]);
});

test('init page modules execute only in the supplied isolated function runtime', async () => {
  for (const source of [
    '// default init\nexport default async ({ page }) => { page.value = "initialized"; };',
    'module.exports = async ({ page }) => { page.value = "initialized"; };',
    'exports.default = async ({ page }) => { page.value = "initialized"; };',
    'const quoted = "export default fake"; export default async ({ page }) => { page.value = "initialized"; };',
  ]) {
    const page = { value: '' };
    const initialize = runInNewContext('(' + playwrightInitPageSource(source) + ')');
    await initialize(page);
    assert.equal(page.value, 'initialized');
  }
});

test('INI config resolves typed settings and relative module paths through the same VFS loader', async () => {
  const result = await resolvePlaywrightOpenOptions({ config: 'settings/browser.ini' }, { ...invocation, async readArtifact(filename) {
    return new TextEncoder().encode(filename.endsWith('.ini')
      ? 'browser.contextOptions.locale=pl-PL\nbrowser.contextOptions.viewport=640x480\ntimeouts.action=1200\ncodegen=none\noutputDir=artifacts\nbrowser.initPage[]=page.js\n'
      : 'export default async ({ page }) => { await page.goto("https://example.com"); };');
  } }, adapter, 4096);
  assert.deepEqual(result.contextOptions.viewport, { width: 640, height: 480 });
  assert.equal(result.contextOptions.locale, 'pl-PL');
  assert.equal(result.configuration?.timeouts?.action, 1200);
  assert.equal(result.configuration?.codegen, 'none');
  assert.equal(result.configuration?.outputDir, 'settings/artifacts');
  assert.equal(result.configuration?.initPages?.[0]?.filename, 'settings/page.js');
});
