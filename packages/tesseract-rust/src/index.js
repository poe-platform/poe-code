import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let native;

function validateNumbers(options) {
  for (const [name, value] of Object.entries({ psm: options.psm, dpi: options.dpi, maxPages: options.maxPages, ...options.limits })) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 0xffffffff)) {
      throw new TypeError(`${name} must be a positive integer no greater than 4294967295`);
    }
  }
}

export function parseTesseract(args) {
  native ??= require('./poe-tesseract.node');
  return native.parseTesseract(args);
}

export function parseOcrmypdf(args) {
  native ??= require('./poe-tesseract.node');
  return native.parseOcrmypdf(args);
}

export async function recognize(image, { signal, ...options } = {}) {
  signal?.throwIfAborted();
  validateNumbers(options);
  native ??= require('./poe-tesseract.node');
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
  native ??= require('./poe-tesseract.node');
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
