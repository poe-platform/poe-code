import { PlaywrightResourceLimitError, type PlaywrightStructureLimits } from './resource-limit.js';

/** Default configuration byte ceiling; host limits may opt into a finite value. */
export const playwrightConfigMaxBytes = Infinity;
const topKeys = new Set(['browser', 'timeouts', 'network', 'console', 'snapshot', 'outputDir', 'outputMaxSize', 'testIdAttribute', 'codegen']);

/** Scan without constructing containers; native parsing only sees admitted graphs. */
export function parsePlaywrightConfigJSON(text: string, limits: PlaywrightStructureLimits = {}): unknown {
  const maxBytes = limits.maxConfigBytes ?? Infinity;
  if (text.length > maxBytes || maxBytes !== Infinity && new TextEncoder().encode(text).byteLength > maxBytes) throw new PlaywrightResourceLimitError('Playwright configuration byte limit exceeded');
  for (const value of Object.values(limits)) if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError('Invalid Playwright configuration limit');
  let index = 0;
  let entries = 0;
  const space = () => { while (' \t\r\n'.includes(text[index] ?? '\0')) index++; };
  const invalid = (): never => { throw new SyntaxError('Invalid Playwright configuration JSON'); };
  const string = (): string => {
    const start = index++;
    while (index < text.length) {
      const character = text[index++];
      if (character === '\\') index++;
      else if (character === '"') return text.slice(start, index);
    }
    return invalid();
  };
  const arrayAllowed = (path: readonly string[]) =>
    path.length === 2 && path[0] === 'browser' && ['initScript', 'initPage'].includes(path[1]!) ||
    path.length === 2 && path[0] === 'network' && ['allowedOrigins', 'blockedOrigins'].includes(path[1]!) ||
    path.length === 3 && path[0] === 'browser' && path[1] === 'contextOptions' && path[2] === 'permissions' ||
    path.length >= 3 && path[0] === 'browser' && path[1] === 'contextOptions' && path[2] === 'storageState';
  const value = (path: readonly string[], depth: number): void => {
    if (++entries > (limits.maxConfigEntries ?? Infinity) || depth > (limits.maxConfigDepth ?? Infinity)) throw new PlaywrightResourceLimitError('Playwright configuration structure limit exceeded');
    space();
    const character = text[index];
    if (character === '{' || character === '[') {
      const isObject = character === '{';
      if (!isObject && !arrayAllowed(path)) throw new Error('Unsupported Playwright configuration array');
      index++; space();
      const end = isObject ? '}' : ']';
      if (text[index] === end) { index++; return; }
      while (index < text.length) {
        let childPath = isObject ? path : [...path, '[]'];
        if (isObject) {
          if (++entries > (limits.maxConfigEntries ?? Infinity)) throw new PlaywrightResourceLimitError('Playwright configuration structure limit exceeded');
          if (text[index] !== '"') invalid();
          const key: string = JSON.parse(string());
          if (path.length === 0 && !topKeys.has(key)) throw new Error(`Unsupported Playwright configuration: ${key}`);
          childPath = [...path, key];
          space(); if (text[index++] !== ':') invalid();
        }
        value(childPath, depth + 1); space();
        if (text[index] === end) { index++; return; }
        if (text[index++] !== ',') invalid();
        space();
      }
      invalid();
    } else if (character === '"') string();
    else {
      const start = index;
      while (index < text.length && !' \t\r\n,]}'.includes(text[index]!)) index++;
      if (index === start) invalid();
    }
  };
  space();
  if (text[index] !== '{') throw new Error('Invalid Playwright configuration');
  value([], 1); space();
  if (index !== text.length) invalid();
  return JSON.parse(text);
}
