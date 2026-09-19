import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { expect, test, vi } from 'vitest';
import { screenshotPreparationModule } from '../scripts/build-browser-screenshot';
import type { prepareBrowserScreenshot, browserScreenshotMethods } from '../src/browser-screenshot.generated.js';

test('identifier-minified screenshot preparation restores caret styles and waits for fonts', async () => {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('@cloudflare/playwright')));
  const source = await readFile(join(root, 'lib/playwright-core/src/server/screenshotter.js'), 'utf8');
  const module = screenshotPreparationModule(source).replaceAll('export const', 'const');
  const { code } = await transform(module + '\nglobalThis.prepare = prepareBrowserScreenshot;', { minify: true, keepNames: true });
  const style = { getPropertyValue: () => 'red', getPropertyPriority: () => '', setProperty: vi.fn() };
  const element = { style };
  const document = { querySelectorAll: () => [element] };
  Object.assign(document, { createTreeWalker: () => ({ currentNode: document, nextNode: () => false }) });
  const sandbox = { document, NodeFilter: { SHOW_ELEMENT: 1 }, Element: class {}, window: {}, process: { env: {} } };
  runInNewContext(code, sandbox);
  const evaluate = vi.fn(async (script: string) => runInNewContext(script, sandbox));
  const fonts = vi.fn(async () => undefined);
  const native = { _page: { delegate: { shouldToggleStyleSheetToSyncAnimations: () => false }, safeNonStallingEvaluateInAllFrames: evaluate } };
  await (sandbox as typeof sandbox & { prepare: typeof prepareBrowserScreenshot }).prepare.call(native, { log: vi.fn(), race: (p: Promise<unknown>) => p }, { nonStallingEvaluateInExistingContext: fonts }, undefined, true, false);
  expect(style.setProperty).toHaveBeenCalledWith('caret-color', 'transparent', 'important');
  expect(fonts).toHaveBeenCalledWith('document.fonts.ready', 'utility');
  runInNewContext('window.__pwCleanupScreenshot()', sandbox);
  expect(style.setProperty).toHaveBeenLastCalledWith('caret-color', 'red', '');
  expect(sandbox.window).not.toHaveProperty('__pwCleanupScreenshot');
});

test('minified screenshot dimensions wait for a document and preserve the configured viewport', async () => {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('@cloudflare/playwright')));
  const source = await readFile(join(root, 'lib/playwright-core/src/server/screenshotter.js'), 'utf8');
  const { code } = await transform(screenshotPreparationModule(source).replaceAll('export const', 'const') + '\nglobalThis.methods = browserScreenshotMethods;', { minify: true, keepNames: true });
  const dimensions = { scrollWidth: 1024, offsetWidth: 1024, clientWidth: 1024, scrollHeight: 2500, offsetHeight: 2500, clientHeight: 2500 };
  const sandbox = { document: { body: null as null | typeof dimensions, documentElement: dimensions } };
  runInNewContext(code, sandbox);
  const frame = {
    async retryWithProgressAndTimeouts(_progress: unknown, _timeouts: number[], action: (sentinel: symbol) => Promise<unknown>) {
      const sentinel = Symbol();
      expect(await action(sentinel)).toBe(sentinel);
      sandbox.document.body = dimensions;
      return action(sentinel);
    },
    async evaluateExpression(expression: string, options: unknown) {
      expect(options).toEqual({ isFunction: true, world: 'utility' });
      return runInNewContext('(' + expression + ')()', sandbox);
    },
  };
  const viewport = { width: 1280, height: 720 };
  const native = { _page: { mainFrame: () => frame, emulatedSize: () => ({ viewport }) } };
  const methods = (sandbox as typeof sandbox & { methods: typeof browserScreenshotMethods }).methods;
  expect(await methods._fullPageSize!.call(native, { race: (p: Promise<unknown>) => p })).toEqual({ width: 1024, height: 2500 });
  expect(await methods._originalViewportSize!.call(native, {})).toBe(viewport);
});
