import type { PlaywrightContext } from './adapter.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';

/** CLI origin patterns only add restrictions; allowed requests retain host routes. */
export async function installPlaywrightConfiguredNetwork(context: PlaywrightContext, configuration: PlaywrightSessionConfiguration | undefined): Promise<void> {
  const allowed = configuration?.network?.allowedOrigins ?? [];
  const blocked = configuration?.network?.blockedOrigins ?? [];
  if (!allowed.length && !blocked.length) return;
  type Route = { request(): { url(): string }; abort(reason: string): Promise<void>; fallback(): Promise<void> };
  const native = context as PlaywrightContext & { route?(pattern: string, handler: (route: Route) => Promise<void>): Promise<unknown> };
  if (!native.route) throw new Error('Browser network configuration unsupported');
  const patterns = (origins: readonly string[]) => origins.map(origin => {
    if (origin.startsWith('http') && origin.endsWith(':*')) return origin;
    try { const parsed = new URL(origin); if (parsed.origin !== 'null') return parsed.origin; } catch { /* Host glob. */ }
    return '*://' + origin;
  });
  const allow = patterns(allowed), deny = patterns(blocked);
  const matches = (pattern: string, origin: string) => {
    let p = 0, cursor = 0, star = -1, retry = 0;
    while (cursor < origin.length) {
      if (pattern[p] === origin[cursor] || pattern[p] === '?') { p++; cursor++; }
      else if (pattern[p] === '*') { star = p++; retry = cursor; }
      else if (star >= 0) { p = star + 1; cursor = ++retry; }
      else return false;
    }
    while (pattern[p] === '*') p++;
    return p === pattern.length;
  };
  await native.route('**', async route => {
    const origin = new URL(route.request().url()).origin;
    if (deny.some(pattern => matches(pattern, origin)) || allow.length && !allow.some(pattern => matches(pattern, origin))) await route.abort('blockedbyclient');
    else await route.fallback();
  });
}

/** Convert a default-export page initializer to a function for the isolated host.
 * Agent source is never evaluated by the controller's own JavaScript runtime. */
export function playwrightInitPageSource(source: string): string {
  let depth = 0, quote = '', escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && source[index + 1] === '/') { const end = source.indexOf('\n', index + 2); index = end < 0 ? source.length : end; continue; }
    if (char === '/' && source[index + 1] === '*') { const end = source.indexOf('*/', index + 2); if (end < 0) throw new Error('Unterminated init page comment'); index = end + 1; continue; }
    if ('\'"`'.includes(char)) { quote = char; continue; }
    if ('{[('.includes(char)) depth++;
    else if ('}])'.includes(char)) depth--;
    else if (depth === 0 && source.startsWith('export', index) && /\s/.test(source[index + 6] ?? '') && (index === 0 || /\s/.test(source[index - 1]!))) {
      const match = source.slice(index).match(/^export\s+default\s+/);
      if (!match) throw new Error('Init page supports a default export; additional module exports require module loading support');
      return `async (page) => { let __playwrightInit;\n${source.slice(0, index)}__playwrightInit = ${source.slice(index + match[0].length)}\nif (typeof __playwrightInit !== 'function') throw new Error('Init page default export must be a function');\nawait __playwrightInit({ page });\n}`;
    }
  }
  return `async (page) => { const module = { exports: {} }; const exports = module.exports;\n${source}\nconst __playwrightInit = module.exports.default ?? module.exports;\nif (typeof __playwrightInit !== 'function') throw new Error('Init page default export must be a function');\nawait __playwrightInit({ page });\n}`;
}
