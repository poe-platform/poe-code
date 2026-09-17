export interface PlaywrightScreenshotOptions {
  readonly type: 'png' | 'jpeg';
  readonly fullPage: boolean;
  readonly timeout: number;
  readonly maxArtifactBytes: number;
  readonly signal?: AbortSignal;
}

export interface PlaywrightScreenshotCaptureOptions {
  readonly type: 'png' | 'jpeg';
  readonly fullPage: boolean;
  readonly timeout: number;
  readonly scale: 'css';
  readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface PlaywrightScreenshotPage {
  evaluate?<Result, Argument>(callback: (argument: Argument) => Result, argument: Argument): Promise<Result>;
  screenshot(options: PlaywrightScreenshotCaptureOptions): Promise<Uint8Array>;
}

export async function capturePlaywrightScreenshot(page: PlaywrightScreenshotPage, options: PlaywrightScreenshotOptions): Promise<Uint8Array> {
  if (!options) throw new TypeError('Invalid screenshot options');
  const { type, fullPage, timeout, maxArtifactBytes } = options;
  options.signal?.throwIfAborted();
  if (!['png', 'jpeg'].includes(type) || typeof fullPage !== 'boolean'
    || !Number.isSafeInteger(timeout) || timeout < 1
    || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1) throw new TypeError('Invalid screenshot options');
  if (!page || typeof page.screenshot !== 'function') throw new Error('Screenshot engine unsupported');
  if (typeof page.evaluate !== 'function') throw new Error('Screenshot geometry evaluation unsupported');
  const geometry = await page.evaluate(fullPage => {
    type ElementDimensions = { scrollWidth: unknown; scrollHeight: unknown; offsetWidth: unknown; offsetHeight: unknown; clientWidth: unknown; clientHeight: unknown };
    try {
      const view = globalThis as unknown as { innerWidth: unknown; innerHeight: unknown; document?: { body?: ElementDimensions | null; documentElement?: ElementDimensions | null } };
      let dimensions: unknown[];
      if (fullPage) {
        const body = view.document?.body;
        const root = view.document?.documentElement;
        if (!body || !root) return null;
        dimensions = [body.scrollWidth, body.scrollHeight, root.scrollWidth, root.scrollHeight,
          body.offsetWidth, body.offsetHeight, root.offsetWidth, root.offsetHeight,
          body.clientWidth, body.clientHeight, root.clientWidth, root.clientHeight];
      } else dimensions = [view.innerWidth, view.innerHeight];
      let width = 0;
      let height = 0;
      for (let index = 0; index < dimensions.length; index += 2) {
        const measuredWidth = dimensions[index];
        const measuredHeight = dimensions[index + 1];
        if (typeof measuredWidth !== 'number' || !(measuredWidth >= 0 && measuredWidth <= 9_007_199_254_740_991)
          || typeof measuredHeight !== 'number' || !(measuredHeight >= 0 && measuredHeight <= 9_007_199_254_740_991)) return null;
        if (measuredWidth > width) width = measuredWidth;
        if (measuredHeight > height) height = measuredHeight;
      }
      return width > 0 && height > 0 ? { width, height } : null;
    } catch { return null; }
  }, fullPage);
  options.signal?.throwIfAborted();
  if (!geometry || typeof geometry !== 'object' || typeof geometry.width !== 'number' || typeof geometry.height !== 'number'
    || geometry.width <= 0 || geometry.height <= 0
    || !Number.isSafeInteger(Math.ceil(geometry.width)) || !Number.isSafeInteger(Math.ceil(geometry.height))) throw new Error('Invalid screenshot dimensions');
  const width = Math.ceil(geometry.width);
  const height = Math.ceil(geometry.height);
  const blockSize = type === 'jpeg' ? 8 : 1;
  const rasterWidth = Math.ceil(width / blockSize) * blockSize;
  const rasterHeight = Math.ceil(height / blockSize) * blockSize;
  const maxPixels = Math.min(Math.floor(maxArtifactBytes / 4), type === 'jpeg' ? 1_000_000 : 4_000_000);
  if (rasterWidth > Math.floor(maxPixels / rasterHeight)) throw new Error('Screenshot pixel limit exceeded');
  const bytes = await page.screenshot({ type, fullPage, timeout, scale: 'css', clip: { x: 0, y: 0, width, height } });
  options.signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Screenshot must return bytes');
  if (bytes.byteLength > maxArtifactBytes) throw new Error('Artifact byte limit exceeded');
  return bytes;
}
