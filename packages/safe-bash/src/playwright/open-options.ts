import type { BrowserEngine, PlaywrightAdapter, PlaywrightContextOptions } from './adapter.js';
import type { PlaywrightInvocation } from './invocation.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';
import { parsePlaywrightStorageState } from './storage-state.js';
import { parsePlaywrightSessionConfiguration, type PlaywrightSessionConfiguration } from './session-configuration.js';
import { parsePlaywrightIniConfig } from './config-ini.js';

const contextKeys = new Set(['storageState', 'userAgent', 'viewport', 'screen', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'locale', 'timezoneId', 'colorScheme', 'reducedMotion', 'forcedColors', 'javaScriptEnabled', 'ignoreHTTPSErrors', 'acceptDownloads', 'permissions', 'geolocation', 'extraHTTPHeaders', 'baseURL', 'offline', 'strictSelectors', 'bypassCSP', 'httpCredentials', 'serviceWorkers']);
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>, name: string) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unsupported ${name}: ${key}`);
}

/** Provider-safe context settings shared by config and persisted session restoration. */
export function parsePlaywrightContextOptions(value: unknown, maxBytes = 8 * 1024 * 1024): PlaywrightContextOptions {
  const context = { ...object(value, 'browser context options') };
  keys(context, contextKeys, 'browser context option');
  const encoded = JSON.stringify(context);
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new PlaywrightResourceLimitError('Browser context options byte limit exceeded');
  for (const key of ['userAgent', 'locale', 'timezoneId', 'baseURL']) if (context[key] !== undefined && typeof context[key] !== 'string') throw new Error(`Invalid browser context option: ${key}`);
  for (const key of ['isMobile', 'hasTouch', 'javaScriptEnabled', 'ignoreHTTPSErrors', 'acceptDownloads', 'offline', 'strictSelectors', 'bypassCSP']) if (context[key] !== undefined && typeof context[key] !== 'boolean') throw new Error(`Invalid browser context option: ${key}`);
  for (const [key, values] of Object.entries({ colorScheme: ['light', 'dark', 'no-preference', null], reducedMotion: ['reduce', 'no-preference', null], forcedColors: ['active', 'none', null], serviceWorkers: ['block'] })) {
    if (context[key] !== undefined && !values.includes(context[key] as string)) throw new Error(`Unsupported browser context option: ${key}=${String(context[key])}`);
  }
  for (const key of ['viewport', 'screen']) {
    if (context[key] === undefined || key === 'viewport' && context[key] === null) continue;
    const size = object(context[key], key);
    keys(size, new Set(['width', 'height']), key);
    if (![size.width, size.height].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error(`Invalid browser context option: ${key}`);
  }
  if (context.deviceScaleFactor !== undefined && (typeof context.deviceScaleFactor !== 'number' || !Number.isFinite(context.deviceScaleFactor) || context.deviceScaleFactor <= 0)) throw new Error('Invalid deviceScaleFactor');
  if (context.permissions !== undefined && (!Array.isArray(context.permissions) || context.permissions.some(value => typeof value !== 'string'))) throw new Error('Invalid context permissions');
  if (context.extraHTTPHeaders !== undefined && Object.values(object(context.extraHTTPHeaders, 'extraHTTPHeaders')).some(value => typeof value !== 'string')) throw new Error('Invalid context headers');
  if (context.httpCredentials !== undefined) {
    const credentials = object(context.httpCredentials, 'httpCredentials');
    keys(credentials, new Set(['username', 'password', 'origin', 'send']), 'httpCredentials');
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || credentials.origin !== undefined && typeof credentials.origin !== 'string' || credentials.send !== undefined && !['unauthorized', 'always'].includes(credentials.send as string)) throw new Error('Invalid httpCredentials');
  }
  if (context.geolocation !== undefined) {
    const geo = object(context.geolocation, 'geolocation');
    keys(geo, new Set(['longitude', 'latitude', 'accuracy']), 'geolocation');
    if (typeof geo.longitude !== 'number' || !Number.isFinite(geo.longitude) || Math.abs(geo.longitude) > 180 || typeof geo.latitude !== 'number' || !Number.isFinite(geo.latitude) || Math.abs(geo.latitude) > 90 || geo.accuracy !== undefined && (typeof geo.accuracy !== 'number' || !Number.isFinite(geo.accuracy) || geo.accuracy < 0)) throw new Error('Invalid geolocation');
  }
  if (context.storageState !== undefined) context.storageState = parsePlaywrightStorageState(context.storageState, { maxBytes });
  return structuredClone(context) as PlaywrightContextOptions;
}

/** Resolve standard CLI configuration using only the invocation's bounded VFS. */
export async function resolvePlaywrightOpenOptions(options: Readonly<Record<string, string | boolean | readonly string[]>>, invocation: PlaywrightInvocation, adapter: PlaywrightAdapter, maxBytes: number): Promise<{
  browser: BrowserEngine; headless: boolean; contextOptions: PlaywrightContextOptions; idleTimeoutMs: number; configuration?: PlaywrightSessionConfiguration;
}> {
  const env = invocation.env;
  const stringEnv = (name: string) => env[name]?.trim() || undefined;
  const boolEnv = (name: string) => env[name] === 'true' || env[name] === '1' ? true : env[name] === 'false' || env[name] === '0' ? false : undefined;
  const relative = (path: string, file: string) => path.startsWith('/') ? path : file.slice(0, file.lastIndexOf('/') + 1) + path;
  const read = async (filename: string, configuration = false): Promise<unknown> => {
    if (!invocation.readArtifact) throw new Error('Artifact byte source unsupported');
    invocation.signal.throwIfAborted();
    const bytes = await invocation.readArtifact(filename, maxBytes);
    invocation.signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw new PlaywrightResourceLimitError('Playwright configuration byte limit exceeded');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return configuration && filename.endsWith('.ini') ? parsePlaywrightIniConfig(text) : JSON.parse(text);
  };
  let selectedConfig = typeof options.config === 'string' ? options.config : stringEnv('PLAYWRIGHT_MCP_CONFIG');
  let filename = selectedConfig ?? '.playwright/cli.config.json';
  const load = async (file: string, optional: boolean): Promise<Record<string, unknown> | undefined> => {
    if (!invocation.readArtifact && optional) return undefined;
    let loaded: Record<string, unknown>;
    try { loaded = object(await read(file, true), 'Playwright configuration'); }
    catch (error) {
      if (!optional || !error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT') throw error;
      return undefined;
    }
    if (loaded.browser !== undefined) {
      const browser = { ...object(loaded.browser, 'browser configuration') };
      if (browser.contextOptions !== undefined) {
        const context = { ...object(browser.contextOptions, 'browser context options') };
        if (typeof context.storageState === 'string') context.storageState = relative(context.storageState, file);
        browser.contextOptions = context;
      }
      if (Array.isArray(browser.initScript)) browser.initScript = browser.initScript.map(path => typeof path === 'string' ? relative(path, file) : path);
      if (Array.isArray(browser.initPage)) browser.initPage = browser.initPage.map(path => typeof path === 'string' ? relative(path, file) : path);
      loaded = { ...loaded, browser };
    }
    if (typeof loaded.outputDir === 'string') loaded.outputDir = relative(loaded.outputDir, file);
    return loaded;
  };
  let preloaded: Record<string, unknown> | undefined;
  if (options.config === undefined && stringEnv('PLAYWRIGHT_MCP_CONFIG')) {
    const defaultFile = '.playwright/cli.config.json';
    const exists = invocation.workspace ? await invocation.workspace.exists(defaultFile) : (preloaded = await load(defaultFile, true)) !== undefined;
    if (exists) { selectedConfig = undefined; filename = defaultFile; }
  }
  const globalHome = stringEnv('PWTEST_CLI_GLOBAL_CONFIG') ?? invocation.workspace?.home ?? stringEnv('HOME');
  const global = globalHome ? await load(globalHome.replace(/\/$/, '') + '/.playwright/cli.config.json', true) ?? {} : {};
  const local = preloaded ?? await load(filename, selectedConfig === undefined) ?? {};
  const globalBrowser = global.browser === undefined ? {} : object(global.browser, 'browser configuration');
  const localBrowser = local.browser === undefined ? {} : object(local.browser, 'browser configuration');
  const mergeObject = (base: unknown, override: unknown, name: string) => ({ ...(base === undefined ? {} : object(base, name)), ...(override === undefined ? {} : object(override, name)) });
  const config: Record<string, unknown> = { ...global, ...local,
    browser: { ...globalBrowser, ...localBrowser, launchOptions: mergeObject(globalBrowser.launchOptions, localBrowser.launchOptions, 'browser launch options'), contextOptions: mergeObject(globalBrowser.contextOptions, localBrowser.contextOptions, 'browser context options') },
    timeouts: mergeObject(global.timeouts, local.timeouts, 'Playwright timeouts'),
    network: mergeObject(global.network, local.network, 'network configuration'),
    console: mergeObject(global.console, local.console, 'console configuration'),
    snapshot: mergeObject(global.snapshot, local.snapshot, 'snapshot configuration'),
  };
  keys(config, new Set(['browser', 'timeouts', 'network', 'console', 'snapshot', 'outputDir', 'outputMaxSize', 'testIdAttribute', 'codegen']), 'Playwright configuration');
  const browserConfig = config.browser === undefined ? {} : object(config.browser, 'browser configuration');
  keys(browserConfig, new Set(['browserName', 'isolated', 'userDataDir', 'launchOptions', 'contextOptions', 'initScript', 'initPage']), 'browser configuration');
  if (options.persistent || options.profile !== undefined || browserConfig.userDataDir !== undefined || browserConfig.isolated === false || stringEnv('PLAYWRIGHT_MCP_USER_DATA_DIR') || boolEnv('PLAYWRIGHT_MCP_ISOLATED') === false) throw new Error('Persistent browser profiles are unsupported by this browser provider');
  const launch = browserConfig.launchOptions === undefined ? {} : object(browserConfig.launchOptions, 'browser launch options');
  keys(launch, new Set(['headless']), 'browser launch option');
  if (launch.headless !== undefined && typeof launch.headless !== 'boolean') throw new Error('Invalid browser headless option');
  const selectedBrowser = options.browser ?? stringEnv('PLAYWRIGHT_MCP_BROWSER') ?? browserConfig.browserName ?? 'chromium';
  const browser = selectedBrowser === 'chrome' ? 'chromium' : selectedBrowser;
  if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') throw new Error(`Unsupported browser: ${String(browser)}`);
  const headless = options.headed ? false : options.headless ? true : boolEnv('PLAYWRIGHT_MCP_HEADLESS') ?? launch.headless !== false;
  const capability = adapter.browsers[browser];
  if (!capability) throw new Error(`Unsupported browser: ${browser}`);
  if (!headless && !capability.headed) throw new Error(`Headed mode is unsupported for ${browser}`);
  let context = browserConfig.contextOptions === undefined ? {} : { ...object(browserConfig.contextOptions, 'browser context options') };
  keys(context, contextKeys, 'browser context option');
  if (context.serviceWorkers === 'allow') throw new Error('Unsupported browser context option: serviceWorkers=allow');
  const deviceContext = (deviceName: unknown, mobile: boolean, selected: unknown): Record<string, unknown> => {
    if (mobile && deviceName) throw new Error('Cannot use --mobile together with --device, pick one.');
    if (mobile && selected === 'firefox') throw new Error('--mobile is not supported with the Firefox browser.');
    if (mobile) deviceName = selected === 'webkit' ? 'iPhone 17' : 'Pixel 10';
    if (deviceName === undefined) return {};
    if (typeof deviceName !== 'string') throw new Error('Invalid device name');
    const device = adapter.devices?.[deviceName];
    if (!device) throw new Error(`Unknown device: ${deviceName}`);
    const { defaultBrowserType: ignoredDefaultBrowserType, ...deviceOptions } = device;
    return deviceOptions;
  };
  context = { ...context, ...deviceContext(stringEnv('PLAYWRIGHT_MCP_DEVICE'), boolEnv('PLAYWRIGHT_MCP_MOBILE') === true, stringEnv('PLAYWRIGHT_MCP_BROWSER')) };
  for (const [name, key] of [['PLAYWRIGHT_MCP_USER_AGENT', 'userAgent'], ['PLAYWRIGHT_MCP_STORAGE_STATE', 'storageState']] as const) if (stringEnv(name) !== undefined) context[key] = stringEnv(name);
  if (boolEnv('PLAYWRIGHT_MCP_IGNORE_HTTPS_ERRORS')) context.ignoreHTTPSErrors = true;
  if (boolEnv('PLAYWRIGHT_MCP_BLOCK_SERVICE_WORKERS')) context.serviceWorkers = 'block';
  if (stringEnv('PLAYWRIGHT_MCP_GRANT_PERMISSIONS')) context.permissions = stringEnv('PLAYWRIGHT_MCP_GRANT_PERMISSIONS')!.split(',').map(value => value.trim());
  const viewport = stringEnv('PLAYWRIGHT_MCP_VIEWPORT_SIZE');
  if (viewport) {
    const dimensions = viewport.split(viewport.includes('x') ? 'x' : ',').map(Number);
    if (dimensions.length !== 2 || dimensions.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid resolution format: use --viewport-size="800x600"');
    context.viewport = { width: dimensions[0]!, height: dimensions[1]! };
  }
  context = { ...context, ...deviceContext(options.device, options.mobile === true, options.browser) };
  if (context.viewport === undefined) context.viewport = headless ? { width: 1280, height: 720 } : null;
  if (context.storageState !== undefined) {
    const stateFile = context.storageState;
    const value = typeof stateFile === 'string' ? await read(stateFile) : stateFile;
    context.storageState = parsePlaywrightStorageState(value, { maxBytes });
  }
  const timeouts = config.timeouts === undefined ? {} : object(config.timeouts, 'Playwright timeouts');
  keys(timeouts, new Set(['idle', 'action', 'navigation', 'settle', 'expect']), 'Playwright timeout');
  for (const [name, key] of [['PLAYWRIGHT_MCP_TIMEOUT_ACTION', 'action'], ['PLAYWRIGHT_MCP_TIMEOUT_NAVIGATION', 'navigation'], ['PLAYWRIGHT_MCP_TIMEOUT_SETTLE', 'settle']] as const) if (stringEnv(name) !== undefined) timeouts[key] = Number(stringEnv(name));
  const idle = options['idle-timeout'] ?? stringEnv('PLAYWRIGHT_MCP_IDLE_TIMEOUT') ?? timeouts.idle ?? (headless ? 3_600_000 : 0);
  const idleTimeoutMs = typeof idle === 'string' && idle.trim() !== '' ? Number(idle) : idle;
  if (typeof idleTimeoutMs !== 'number' || !Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0) throw new Error('Invalid idle timeout');
  const effective: Record<string, unknown> = {};
  if (selectedConfig !== undefined || Object.keys(local).length) effective.configFile = filename;
  for (const name of ['testIdAttribute', 'outputDir', 'outputMaxSize', 'codegen']) if (config[name] !== undefined) effective[name] = config[name];
  for (const name of ['network', 'console', 'snapshot']) if (Object.keys(config[name] as object).length) effective[name] = config[name];
  for (const [envName, key] of [['PLAYWRIGHT_MCP_TEST_ID_ATTRIBUTE', 'testIdAttribute'], ['PLAYWRIGHT_MCP_OUTPUT_DIR', 'outputDir'], ['PLAYWRIGHT_MCP_CODEGEN', 'codegen']] as const) if (stringEnv(envName)) effective[key] = stringEnv(envName);
  if (stringEnv('PLAYWRIGHT_MCP_OUTPUT_MAX_SIZE')) effective.outputMaxSize = Number(stringEnv('PLAYWRIGHT_MCP_OUTPUT_MAX_SIZE'));
  const network = effective.network === undefined ? {} : object(effective.network, 'network configuration');
  for (const [envName, key] of [['PLAYWRIGHT_MCP_ALLOWED_ORIGINS', 'allowedOrigins'], ['PLAYWRIGHT_MCP_BLOCKED_ORIGINS', 'blockedOrigins']] as const) if (stringEnv(envName)) network[key] = stringEnv(envName)!.split(';').map(value => value.trim());
  if (Object.keys(network).length) effective.network = network;
  if (stringEnv('PLAYWRIGHT_MCP_CONSOLE_LEVEL')) effective.console = { ...object(config.console, 'console configuration'), level: stringEnv('PLAYWRIGHT_MCP_CONSOLE_LEVEL') };
  // The canonical CLI overrides snapshot mode to full after file/environment config.
  if (effective.snapshot !== undefined) effective.snapshot = { ...object(effective.snapshot, 'snapshot configuration'), mode: 'full' };
  if (boolEnv('PLAYWRIGHT_MCP_SNAPSHOT_BOXES') !== undefined) effective.snapshot = { ...(effective.snapshot as object), mode: 'full', boxes: boolEnv('PLAYWRIGHT_MCP_SNAPSHOT_BOXES') };
  const commandTimeouts = Object.fromEntries(Object.entries(timeouts).filter(([name]) => name !== 'idle'));
  if (Object.keys(commandTimeouts).length) effective.timeouts = commandTimeouts;
  const initScript = stringEnv('PLAYWRIGHT_MCP_INIT_SCRIPT') ? [stringEnv('PLAYWRIGHT_MCP_INIT_SCRIPT')!] : browserConfig.initScript;
  if (initScript !== undefined) {
    if (!Array.isArray(initScript) || initScript.some(path => typeof path !== 'string')) throw new Error('Invalid browser initScript');
    if (!invocation.readArtifact) throw new Error('Artifact byte source unsupported');
    const contents: string[] = [];
    effective.initScripts = contents;
    effective.initScriptFiles = initScript;
    let bytesRead = 0;
    for (const script of initScript) {
      const bytes = await invocation.readArtifact(script, maxBytes - bytesRead);
      invocation.signal.throwIfAborted();
      bytesRead += bytes.byteLength;
      if (bytesRead > maxBytes) throw new PlaywrightResourceLimitError('Playwright init script byte limit exceeded');
      contents.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
  }
  const initPage = stringEnv('PLAYWRIGHT_MCP_INIT_PAGE') ? [stringEnv('PLAYWRIGHT_MCP_INIT_PAGE')!] : browserConfig.initPage;
  if (initPage !== undefined) {
    if (!Array.isArray(initPage) || initPage.some(path => typeof path !== 'string')) throw new Error('Invalid browser initPage');
    if (!invocation.readArtifact) throw new Error('Artifact byte source unsupported');
    const pages: { filename: string; source: string }[] = [];
    effective.initPages = pages;
    let bytesRead = 0;
    for (const filename of initPage) {
      const bytes = await invocation.readArtifact(filename, maxBytes - bytesRead);
      invocation.signal.throwIfAborted(); bytesRead += bytes.byteLength;
      if (bytesRead > maxBytes) throw new PlaywrightResourceLimitError('Playwright init page byte limit exceeded');
      pages.push({ filename, source: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    }
  }
  return { browser, headless, contextOptions: parsePlaywrightContextOptions(context, maxBytes), idleTimeoutMs,
    ...(Object.keys(effective).length ? { configuration: parsePlaywrightSessionConfiguration(effective, maxBytes) } : {}),
  };
}
