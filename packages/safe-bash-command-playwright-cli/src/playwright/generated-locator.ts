import type { PlaywrightPage } from './adapter.js';
import { playwrightLocatorSelector } from './locator-selector.js';

/** Preserve the native selector generator rather than guessing semantic locators. */
export async function generatedPlaywrightLocator(page: PlaywrightPage, selector: string, resolveReference: boolean): Promise<string> {
  let locator = page.locator(resolveReference ? selector : playwrightLocatorSelector(page, selector));
  if (resolveReference) {
    if (locator.normalize) locator = await locator.normalize();
    else if (locator._resolveSelector) {
      const result: unknown = await locator._resolveSelector();
      if (!result || typeof result !== 'object' || !('resolvedSelector' in result) || typeof result.resolvedSelector !== 'string') throw new Error('Incompatible native locator protocol result');
      locator = page.locator(result.resolvedSelector);
    } else throw new Error('Native locator generation unavailable');
  }
  const result = locator.toString();
  if (result === '[object Object]') throw new Error('Native locator description unavailable');
  return result;
}
