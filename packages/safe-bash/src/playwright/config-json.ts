import { PlaywrightResourceLimitError } from './resource-limit.js';

/** Config is small even when the caller admits large artifacts or scripts. */
export const playwrightConfigMaxBytes = 128 * 1024;
const topKeys = new Set(['browser', 'timeouts', 'network', 'console', 'snapshot', 'outputDir', 'outputMaxSize', 'testIdAttribute', 'codegen']);

/** Scan without constructing containers; native parsing only sees admitted graphs. */
export function parsePlaywrightConfigJSON(text: string): unknown {
  if (text.length > playwrightConfigMaxBytes) throw new PlaywrightResourceLimitError('Playwright configuration byte limit exceeded');
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
    if (++entries > 4096 || depth > 32) throw new PlaywrightResourceLimitError('Playwright configuration structure limit exceeded');
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
          if (++entries > 4096) throw new PlaywrightResourceLimitError('Playwright configuration structure limit exceeded');
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
