import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let native;

function loadNative() {
  const local = new URL('./poe-tesseract.node', import.meta.url);
  if (existsSync(local)) return require(fileURLToPath(local));
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) {
    throw new Error(`Tesseract has no prebuilt binary for ${platform}`);
  }
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('Tesseract Linux binaries require glibc');
  }
  return require(`@poe-platform/tesseract-${platform}`);
}

function validateNumbers(options) {
  for (const [name, value] of Object.entries({ psm: options.psm, dpi: options.dpi, maxPages: options.maxPages, ...options.limits })) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 0xffffffff)) {
      throw new TypeError(`${name} must be a positive integer no greater than 4294967295`);
    }
  }
}

export function parseTesseract(args) {
  native ??= loadNative();
  return native.parseTesseract(args);
}

export function parseOcrmypdf(args) {
  native ??= loadNative();
  return native.parseOcrmypdf(args);
}

export async function recognize(image, { signal, ...options } = {}) {
  signal?.throwIfAborted();
  validateNumbers(options);
  native ??= loadNative();
  const cancellation = new native.Cancellation();
  const cancel = () => cancellation.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await native.recognize(image, options, cancellation);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export async function recognizePdf(pdf, { signal, skipText = false, maxPages = 100, ...options } = {}) {
  signal?.throwIfAborted();
  validateNumbers({ ...options, maxPages });
  native ??= loadNative();
  const cancellation = new native.Cancellation();
  const cancel = () => cancellation.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await native.recognizePdf(pdf, options, skipText, maxPages, cancellation);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
