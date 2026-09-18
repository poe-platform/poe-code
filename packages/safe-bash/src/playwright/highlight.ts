import type { PlaywrightElementHandle, PlaywrightPage } from './adapter.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

/** Older Cloudflare clients have only a single temporary native highlight. This
 * page-owned overlay supplies persistent styling/removal with no host state. */
export async function updatePlaywrightHighlight(page: PlaywrightPage, target: PlaywrightElementHandle | undefined, options: { hide: boolean; style?: string }): Promise<void> {
  const update = (input: { target: unknown; hide: boolean; style?: string }): boolean => {
    type Rectangle = { x: number; y: number; width: number; height: number };
    type Node = { isConnected: boolean; getBoundingClientRect(): Rectangle; style: { cssText: string; left: string; top: string; width: string; height: string }; remove(): void; setAttribute(name: string, value: string): void };
    type Highlight = { target: Node; overlay: Node };
    type State = { entries: Map<Node, Highlight>; refresh(): void };
    const browser = globalThis as unknown as {
      document: { createElement(name: string): Node; documentElement: { appendChild(node: Node): void } };
      addEventListener(event: string, listener: () => void, capture?: boolean): void;
      removeEventListener(event: string, listener: () => void, capture?: boolean): void;
    };
    const key = Symbol.for('safe-bash.playwright.highlights');
    let state = Reflect.get(globalThis, key) as State | undefined;
    const element = input.target as Node | undefined;
    if (input.hide) {
      if (!state) return true;
      for (const [node, entry] of state.entries) if (!element || node === element) { entry.overlay.remove(); state.entries.delete(node); }
      if (!state.entries.size) {
        browser.removeEventListener('scroll', state.refresh, true); browser.removeEventListener('resize', state.refresh);
        Reflect.deleteProperty(globalThis, key);
      }
      return true;
    }
    if (!element?.isConnected) throw new Error('Highlight target is detached');
    if (!state) {
      const entries = new Map<Node, Highlight>();
      const holder: State = { entries, refresh() {
        for (const entry of entries.values()) {
          if (!entry.target.isConnected) { entry.overlay.remove(); entries.delete(entry.target); continue; }
          const box = entry.target.getBoundingClientRect();
          Object.assign(entry.overlay.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
        }
      } };
      state = holder; Reflect.set(globalThis, key, state);
      browser.addEventListener('scroll', holder.refresh, true); browser.addEventListener('resize', holder.refresh);
    }
    if (!state.entries.has(element) && state.entries.size >= 128) return false;
    let entry = state.entries.get(element);
    if (!entry) {
      const overlay = browser.document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      entry = { target: element, overlay }; state.entries.set(element, entry);
      browser.document.documentElement.appendChild(overlay);
    }
    entry.overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;outline:2px solid #1a73e8;background:#1a73e833;' + (input.style ?? '');
    state.refresh();
    return true;
  };
  let result: boolean;
  if (target) result = await target.evaluate((node, { source, hide, style }) => {
    const operation = eval(`(${source})`) as (input: { target: unknown; hide: boolean; style?: string }) => boolean;
    return operation({ target: node, hide, ...(style === undefined ? {} : { style }) });
  }, { source: update.toString(), hide: options.hide, style: options.style });
  else {
    if (!page.evaluate) throw new Error('Browser highlight evaluation unavailable');
    const input = { target: undefined, hide: options.hide, ...(options.style === undefined ? {} : { style: options.style }) };
    const frames = page.frames?.();
    if (frames?.length && frames.every(frame => frame.evaluate)) {
      result = true;
      for (const frame of frames) if (!await frame.evaluate!(update, input)) result = false;
    } else result = await page.evaluate(update, input);
  }
  if (!result) throw new PlaywrightResourceLimitError('Playwright highlight retention limit exceeded');
}
