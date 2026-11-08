import type { Page } from '@cloudflare/playwright';
import { browserScreenshotMethods } from './browser-screenshot.generated.js';

/** The pinned Worker provider owns its screenshotter locally, like its tracing server. */
export function prepareBrowserScreenshots(page: Page): void {
  const bridge = page as unknown as {
    // type-erasure-boundary -- The pinned provider's private bridge exposes the local server screenshotter.
    _connection: { toImpl(page: Page): { screenshotter: typeof browserScreenshotMethods } };
  };
  const native = bridge._connection.toImpl(page);
  Object.assign(native.screenshotter, browserScreenshotMethods);
}
