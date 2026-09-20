import type { PlaywrightAbility, PlaywrightAbilityRequest } from './abilities.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightCookie } from './adapter.js';
import type { PlaywrightCommand } from './catalog.js';
import { capabilityArtifact, capabilityResult, numeric, requirePage, requireSession, unsupported } from './capability-result.js';
import { parsePlaywrightStorageState } from './storage-state.js';
import { readPlaywrightStorageState, replacePlaywrightStorageState } from './native-storage-replacement.js';

const stateSave: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const context = requireSession(request).context;
  if (!context.storageState) unsupported('storageState');
  // CLI 0.1.20 does not request IndexedDB. Its state-load accepts explicitly
  // supplied state and passes all supported state fields to the native browser.
  const state = await readPlaywrightStorageState(context, { signal: request.signal, maxBytes: request.limits?.maxArtifactBytes ?? 1048576, registerCleanup: cleanup => request.registerCleanup(cleanup) });
  request.signal.throwIfAborted();
  return capabilityArtifact(request, new TextEncoder().encode(JSON.stringify(state, null, 2)), 'storage-state', 'json', 'Storage state', filename => `await page.context().storageState({ path: ${JSON.stringify(filename)} });`, request.args[0]);
} };

const stateLoad: PlaywrightAbility = { scope: 'session', async execute(request) {
  const session = requireSession(request);
  const bytes = await request.readFile(request.args[0]!);
  const state = parsePlaywrightStorageState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { maxBytes: request.limits?.maxCommandBytes ?? 1048576 });
  request.signal.throwIfAborted();
  if (session.context.setStorageState) await session.context.setStorageState(state);
  else await replacePlaywrightStorageState(session.context, state, { signal: request.signal, maxBytes: request.limits?.maxCommandBytes ?? 1048576, registerCleanup: cleanup => request.registerCleanup(cleanup) });
  return capabilityResult(`await page.context().setStorageState(${JSON.stringify(request.args[0])});`, `Storage state restored from ${request.args[0]}`);
} };

const cookies: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const context = requireSession(request).context;
  const name = request.args[0]!;
  if (request.command === 'cookie-list' || request.command === 'cookie-get') {
    if (!context.cookies) unsupported('cookies');
    let values = await context.cookies();
    if (request.options.domain) values = values.filter(cookie => cookie.domain.includes(request.options.domain as string));
    if (request.options.path) values = values.filter(cookie => cookie.path.startsWith(request.options.path as string));
    const cookie = values.find(item => item.name === name);
    const text = request.command === 'cookie-get'
      ? cookie ? `${cookie.name}=${cookie.value} (domain: ${cookie.domain}, path: ${cookie.path}, httpOnly: ${cookie.httpOnly}, secure: ${cookie.secure}, sameSite: ${cookie.sameSite})` : `Cookie '${name}' not found`
      : values.length ? values.map(cookie => `${cookie.name}=${cookie.value} (domain: ${cookie.domain}, path: ${cookie.path})`).join('\n') : 'No cookies found';
    return capabilityResult('await page.context().cookies();', text);
  }
  if (request.command === 'cookie-set') {
    if (!context.addCookies) unsupported('addCookies');
    const cookie: PlaywrightCookie = { name, value: request.args[1]!, domain: request.options.domain as string || new URL(requirePage(request).url()).hostname, path: request.options.path as string || '/' };
    if (request.options.expires !== undefined) cookie.expires = numeric(request.options.expires, 'cookie expires');
    if (request.options.httpOnly !== undefined) cookie.httpOnly = request.options.httpOnly === true;
    if (request.options.secure !== undefined) cookie.secure = request.options.secure === true;
    if (request.options.sameSite !== undefined) {
      const value = request.options.sameSite;
      if (value !== 'Strict' && value !== 'Lax' && value !== 'None') throw new Error('Invalid cookie sameSite');
      cookie.sameSite = value;
    }
    await context.addCookies([cookie]);
    return capabilityResult(`await page.context().addCookies([${JSON.stringify(cookie)}]);`);
  }
  if (!context.clearCookies) unsupported('clearCookies');
  const filter = request.command === 'cookie-delete' ? { name } : undefined;
  await context.clearCookies(filter);
  return capabilityResult(`await page.context().clearCookies(${filter ? `{ name: ${JSON.stringify(name)} }` : ''});`);
} };

async function webStorage(request: PlaywrightAbilityRequest) {
  const page = requirePage(request);
  if (!page.evaluate) unsupported('evaluate');
  const storage = request.command.startsWith('local') ? 'localStorage' : 'sessionStorage';
  const operation = request.command.slice(request.command.indexOf('-') + 1);
  const key = request.args[0] ?? '';
  const value = request.args[1] ?? '';
  const result = await page.evaluate(({ storage, operation, key, value, maxBytes }) => {
    const browser = globalThis as unknown as Record<string, { length: number; key(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; clear(): void }>;
    const target = browser[storage]!;
    if (operation === 'set') { target.setItem(key, value); return null; }
    if (operation === 'delete') { target.removeItem(key); return null; }
    if (operation === 'clear') { target.clear(); return null; }
    const values: { name: string; value: string }[] = [];
    let bytes = 0;
    for (let index = 0; index < (operation === 'get' ? 1 : target.length); index++) {
      const name = operation === 'get' ? key : target.key(index);
      if (name === null) continue;
      const value = target.getItem(name);
      if (value === null) continue;
      bytes += new TextEncoder().encode(name).length + new TextEncoder().encode(value).length + 2;
      if (bytes > maxBytes) return false;
      values.push({ name, value });
    }
    return values;
  }, { storage, operation, key, value, maxBytes: request.limits?.maxCommandBytes ?? 1048576 });
  if (result === false) throw new PlaywrightResourceLimitError('Playwright storage result byte limit exceeded');
  const method = { list: 'items', get: 'getItem', set: 'setItem', delete: 'removeItem', clear: 'clear' }[operation];
  const args = ['get', 'set', 'delete'].includes(operation) ? [key, ...(operation === 'set' ? [value] : [])].map(item => JSON.stringify(item)).join(', ') : '';
  const text = result === null ? undefined : result.length ? result.map(item => `${item.name}=${item.value}`).join('\n') : operation === 'get' ? `${storage} key '${key}' not found` : `No ${storage} items found`;
  return capabilityResult(`await page.${storage}.${method}(${args});`, text);
}

export const playwrightStorageAbilities: Partial<Record<PlaywrightCommand, PlaywrightAbility>> = {
  'state-save': stateSave, 'state-load': stateLoad,
  ...Object.fromEntries(['cookie-list', 'cookie-get', 'cookie-set', 'cookie-delete', 'cookie-clear'].map(command => [command, cookies])),
  ...Object.fromEntries(['localstorage', 'sessionstorage'].flatMap(prefix => ['list', 'get', 'set', 'delete', 'clear'].map(operation => [`${prefix}-${operation}`, { scope: 'session', execute: webStorage }]))),
};
