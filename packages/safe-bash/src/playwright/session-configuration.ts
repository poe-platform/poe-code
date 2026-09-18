import { PlaywrightResourceLimitError } from './resource-limit.js';

export interface PlaywrightSessionConfiguration {
  readonly browserName?: 'chromium' | 'firefox' | 'webkit';
  readonly headless?: boolean;
  readonly timeouts?: { readonly action?: number; readonly navigation?: number; readonly settle?: number; readonly expect?: number };
  readonly initScripts?: readonly string[];
  readonly initScriptFiles?: readonly string[];
  readonly initPages?: readonly { readonly filename: string; readonly source: string }[];
  readonly testIdAttribute?: string;
  readonly network?: { readonly allowedOrigins?: readonly string[]; readonly blockedOrigins?: readonly string[] };
  readonly console?: { readonly level?: 'error' | 'warning' | 'info' | 'debug' };
  readonly snapshot?: { readonly mode?: 'full' | 'incremental' | 'none'; readonly boxes?: boolean };
  readonly outputDir?: string;
  readonly outputMaxSize?: number;
  readonly configFile?: string;
  readonly codegen?: 'typescript' | 'python' | 'java' | 'csharp' | 'none';
}

/** Shared validation for user configuration and owner-persisted restore data. */
export function parsePlaywrightSessionConfiguration(value: unknown, maxBytes = 8 * 1024 * 1024): PlaywrightSessionConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['browserName', 'headless', 'timeouts', 'initScripts', 'initScriptFiles', 'initPages', 'testIdAttribute', 'network', 'console', 'snapshot', 'outputDir', 'outputMaxSize', 'configFile', 'codegen'].includes(key))) throw new Error('Invalid Playwright session configuration');
  const candidate = value as Record<string, unknown>;
  if (candidate.browserName !== undefined && !['chromium', 'firefox', 'webkit'].includes(candidate.browserName as string)) throw new Error('Invalid configured browser');
  if (candidate.headless !== undefined && typeof candidate.headless !== 'boolean') throw new Error('Invalid configured headless mode');
  if (candidate.timeouts !== undefined) {
    if (!candidate.timeouts || typeof candidate.timeouts !== 'object' || Array.isArray(candidate.timeouts)) throw new Error('Invalid Playwright timeouts');
    for (const [key, timeout] of Object.entries(candidate.timeouts)) if (!['action', 'navigation', 'settle', 'expect'].includes(key) || typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 0) throw new Error(`Invalid Playwright timeout: ${key}`);
  }
  if (candidate.initScripts !== undefined && (!Array.isArray(candidate.initScripts) || candidate.initScripts.some(script => typeof script !== 'string'))) throw new Error('Invalid Playwright init scripts');
  if (candidate.initScriptFiles !== undefined && (!Array.isArray(candidate.initScriptFiles) || candidate.initScriptFiles.some(path => typeof path !== 'string' || path.includes('\0')))) throw new Error('Invalid Playwright init script files');
  if (candidate.initPages !== undefined && (!Array.isArray(candidate.initPages) || candidate.initPages.some(page => !page || typeof page !== 'object' || Object.keys(page).some(key => !['filename', 'source'].includes(key)) || typeof page.filename !== 'string' || typeof page.source !== 'string'))) throw new Error('Invalid Playwright init page modules');
  for (const name of ['testIdAttribute', 'outputDir', 'configFile']) if (candidate[name] !== undefined && (typeof candidate[name] !== 'string' || !candidate[name] || candidate[name].includes('\0'))) throw new Error(`Invalid Playwright ${name}`);
  if (candidate.codegen !== undefined && !['typescript', 'python', 'java', 'csharp', 'none'].includes(candidate.codegen as string)) throw new Error('Invalid Playwright codegen language');
  if (candidate.outputMaxSize !== undefined && (typeof candidate.outputMaxSize !== 'number' || !Number.isSafeInteger(candidate.outputMaxSize) || candidate.outputMaxSize < 0)) throw new Error('Invalid Playwright outputMaxSize');
  for (const [name, fields] of [['network', ['allowedOrigins', 'blockedOrigins']], ['console', ['level']], ['snapshot', ['mode', 'boxes']]] as const) {
    const setting = candidate[name];
    if (setting === undefined) continue;
    if (!setting || typeof setting !== 'object' || Array.isArray(setting) || Object.keys(setting).some(key => !(fields as readonly string[]).includes(key))) throw new Error(`Invalid Playwright ${name}`);
    for (const [key, entry] of Object.entries(setting)) {
      if (name === 'network' && (!Array.isArray(entry) || entry.some(origin => typeof origin !== 'string' || !origin || origin.includes('\0')))) throw new Error('Invalid Playwright network origins');
      if (name === 'console' && !['error', 'warning', 'info', 'debug'].includes(entry)) throw new Error('Invalid Playwright console level');
      if (name === 'snapshot' && (key === 'mode' ? !['full', 'incremental', 'none'].includes(entry) : typeof entry !== 'boolean')) throw new Error('Invalid Playwright snapshot configuration');
    }
  }
  if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > maxBytes) throw new PlaywrightResourceLimitError('Playwright session configuration byte limit exceeded');
  return structuredClone(candidate) as PlaywrightSessionConfiguration;
}
