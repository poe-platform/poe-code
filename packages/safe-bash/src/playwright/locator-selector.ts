import type { PlaywrightPage } from './adapter.js';
import { parseCanonicalPlaywrightLocator } from './canonical-locator-parser.js';

const testIdAttributes = new WeakMap<object, string>();
export function setPlaywrightTestIdAttribute(page: PlaywrightPage, attribute: string | undefined): void {
  const key = page.mainFrame?.() ?? page;
  if (attribute === undefined) testIdAttributes.delete(key);
  else testIdAttributes.set(key, attribute);
}

// The native generator prefers locator(...).contentFrame(); the CLI also
// accepts the equivalent frameLocator(...) spelling, including nth/first/last.
function normalizeFrameAliases(value: string): string {
  let output = '', start = 0, quote = '', escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if ('\'"`/'.includes(char)) { quote = char; continue; }
    if (!value.startsWith('locator(', index) || index && value[index - 1] !== '.') continue;
    let depth = 1, end = index + 'locator('.length, innerQuote = '', innerEscaped = false;
    for (; end < value.length; end++) {
      const next = value[end]!;
      if (innerQuote) {
        if (innerEscaped) innerEscaped = false;
        else if (next === '\\') innerEscaped = true;
        else if (next === innerQuote) innerQuote = '';
      } else if ('\'"`/'.includes(next)) innerQuote = next;
      else if (next === '(') depth++;
      else if (next === ')' && --depth === 0) break;
    }
    const suffix = value.slice(end + 1).match(/^(\.(?:first|last)\(\)|\.nth\(-?\d+\))?\.contentFrame\(\)/);
    if (!suffix) continue;
    output += value.slice(start, index) + 'frameLocator' + value.slice(index + 'locator'.length, end + 1) + (suffix[1] ?? '');
    index = end + suffix[0].length;
    start = index + 1;
  }
  return output + value.slice(start);
}

/** Parse standard generated locator syntax without evaluating agent code. */
export function playwrightLocatorSelector(page: PlaywrightPage, target: string): string {
  const expression = target.trim();
  const method = expression.slice(0, expression.indexOf('(')).trim();
  if (!['locator', 'frameLocator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId'].includes(method)) return target;
  const { selector } = parseCanonicalPlaywrightLocator(expression, testIdAttributes.get(page.mainFrame?.() ?? page));
  const digest = (value: string) => normalizeFrameAliases(value.replace(/\s/g, '')).replace(/\\?["`]/g, "'").replace(/,\{\}/g, '');
  if (digest(page.locator(selector).toString()) !== digest(expression)) throw new Error(`Invalid Playwright locator: ${target}`);
  return selector;
}
