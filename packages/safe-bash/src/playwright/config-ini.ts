import { PlaywrightResourceLimitError } from './resource-limit.js';

type IniType = 'string' | 'number' | 'boolean' | 'string[]' | 'size';
const types = new Map<string, IniType>();
function fields(prefix: string, type: IniType, names: string): void {
  for (const name of names.split(' ')) types.set(prefix + name, type);
}
fields('browser.', 'string', 'browserName userDataDir cdpEndpoint remoteEndpoint');
fields('browser.', 'boolean', 'isolated');
fields('browser.', 'number', 'cdpTimeout');
fields('browser.', 'string[]', 'initPage initScript');
fields('browser.launchOptions.', 'string', 'channel executablePath downloadsPath tracesDir proxy.server proxy.bypass proxy.username proxy.password');
fields('browser.launchOptions.', 'boolean', 'headless chromiumSandbox handleSIGHUP handleSIGINT handleSIGTERM');
fields('browser.launchOptions.', 'number', 'slowMo timeout');
fields('browser.launchOptions.', 'string[]', 'args');
fields('browser.contextOptions.', 'string', 'baseURL colorScheme contrast forcedColors locale reducedMotion serviceWorkers storageState timezoneId userAgent');
fields('browser.contextOptions.', 'boolean', 'acceptDownloads bypassCSP hasTouch ignoreHTTPSErrors isMobile javaScriptEnabled offline strictSelectors');
fields('browser.contextOptions.', 'number', 'deviceScaleFactor');
fields('browser.contextOptions.', 'string[]', 'permissions');
fields('browser.contextOptions.', 'size', 'screen viewport');
fields('', 'string', 'outputDir imageResponses codegen testIdAttribute server.host console.level snapshot.mode');
fields('', 'boolean', 'extension saveSession sharedBrowserContext allowUnrestrictedFileAccess snapshot.boxes');
fields('', 'number', 'outputMaxSize server.port timeouts.action timeouts.idle timeouts.navigation timeouts.settle');
fields('', 'string[]', 'capabilities server.allowedHosts network.allowedOrigins network.blockedOrigins');
fields('', 'size', 'saveVideo');

function token(source: string): unknown {
  const text = source.trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.at(-1) === quote) {
    const unquoted = quote === "'" ? text.slice(1, -1) : text;
    try { return JSON.parse(unquoted); } catch { return unquoted; }
  }
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === ';' || char === '#') break;
    if (char === '\\' && text[i + 1] && '\\;#'.includes(text[i + 1]!)) result += text[++i];
    else result += char;
  }
  return result.trim();
}

function safePath(parts: string[]): void {
  if (parts.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Invalid INI configuration path');
}
function assign(root: Record<string, unknown>, parts: string[], value: unknown): void {
  safePath(parts);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const previous = Object.hasOwn(current, part) ? current[part] : undefined;
    if (!previous || typeof previous !== 'object') current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function sectionParts(name: string): string[] {
  const parts = [''];
  for (let i = 0; i < name.length; i++) {
    const char = name[i]!;
    if (char === '\\' && name[i + 1] === '.') { parts[parts.length - 1] = parts.at(-1)! + '.'; i++; }
    else if (char === '.') parts.push('');
    else parts[parts.length - 1] = parts.at(-1)! + char;
  }
  return parts;
}

function readEntries(text: string): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  let current = entries;
  for (const line of text.split('\r').join('\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (line.startsWith('[') && line.indexOf(']') === line.trimEnd().length - 1) {
      const name = String(token(line.slice(1, line.indexOf(']'))));
      if (name === '__proto__') { current = {}; continue; }
      safePath(sectionParts(name));
      if (!Object.hasOwn(entries, name)) entries[name] = {};
      const section = entries[name];
      if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error('Invalid INI section');
      current = section as Record<string, unknown>;
      continue;
    }
    const equal = line.indexOf('=');
    if (equal === 0) continue;
    const rawKey = String(token(equal < 0 ? line : line.slice(0, equal)));
    const array = rawKey.length > 2 && rawKey.endsWith('[]');
    const key = array ? rawKey.slice(0, -2) : rawKey;
    if (key === '__proto__') continue;
    safePath(key.split('.'));
    const raw = equal < 0 ? true : token(line.slice(equal + 1));
    const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : raw;
    if (array && !Array.isArray(current[key])) current[key] = Object.hasOwn(current, key) ? [current[key]] : [];
    const previous = current[key];
    if (Array.isArray(previous)) previous.push(value);
    else current[key] = value;
  }
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value !== 'object' || Array.isArray(value)) continue;
    const parts = sectionParts(name);
    if (parts.length === 1 && parts[0] === name) continue;
    assign(entries, parts, value);
    delete entries[name];
  }
  return entries;
}

function coerce(value: unknown, type: IniType | undefined): unknown {
  if (type === 'string') return String(value);
  if (type === 'number') return Number(value);
  if (type === 'boolean') return typeof value === 'boolean' ? value : value === 'true' || value === '1';
  if (type === 'string[]') return (Array.isArray(value) ? value : [value]).map(String);
  if (type === 'size') {
    if (typeof value !== 'string' || !value.includes('x')) return undefined;
    const [width, height] = value.split('x').map(Number);
    return width !== undefined && height !== undefined && !Number.isNaN(width) && !Number.isNaN(height) && width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return value;
  const number = Number(value.trim());
  return Number.isNaN(number) ? value : number;
}

/** Native INI longhand coercion; ordinary config validation runs after parsing. */
export function parsePlaywrightIniConfig(text: string): Record<string, unknown> {
  const maximum = 8 * 1024 * 1024;
  if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) throw new PlaywrightResourceLimitError('Playwright INI configuration byte limit exceeded');
  const config: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(readEntries(text))) assign(config, path.split('.'), coerce(value, types.get(path)));
  return config;
}
