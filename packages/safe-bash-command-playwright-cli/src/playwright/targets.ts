import type { PlaywrightElementHandle, PlaywrightPage } from './adapter.js';
import { playwrightLocatorSelector } from './locator-selector.js';

export function isPlaywrightSnapshotRef(target: string): boolean {
  let index = 0;
  if (target[index] === 'f') {
    index++;
    const start = index;
    while (index < target.length && '0123456789'.includes(target[index]!)) index++;
    if (index === start) return false;
  }
  if (target[index++] !== 'e' || index === target.length) return false;
  return [...target.slice(index)].every(character => '0123456789'.includes(character));
}

/** Native locator resolution retains Playwright strictness; refs never fall back to selectors. */
export async function resolvePlaywrightTarget(options: {
  readonly target: string;
  readonly page: PlaywrightPage;
  readonly timeout: number;
  readonly signal: AbortSignal;
  resolveRef(ref: string): Promise<PlaywrightElementHandle>;
  own(handle: PlaywrightElementHandle): void;
}): Promise<PlaywrightElementHandle> {
  options.signal.throwIfAborted();
  if (isPlaywrightSnapshotRef(options.target)) return options.resolveRef(options.target);
  if (options.target.split('>>').some(part => part.slice(0, part.indexOf('=')).trim() === 'aria-ref')) throw new Error('Use an issued snapshot reference instead of a native aria-ref selector');
  const selector = playwrightLocatorSelector(options.page, options.target);
  if (selector.split('>>').some(part => part.slice(0, part.indexOf('=')).trim() === 'aria-ref')) throw new Error('Use an issued snapshot reference instead of a native aria-ref selector');
  const locator = options.page.locator(selector);
  if (!locator.elementHandle) throw new Error('Selector resolution is unavailable in this browser');
  const handle = await locator.elementHandle({ timeout: options.timeout });
  if (!handle) throw new Error(`"${options.target}" does not match any elements.`);
  options.own(handle);
  options.signal.throwIfAborted();
  return handle;
}
