import { FsError } from 'safe-bash-contracts';
import { inheritYieldCheckpoint, yieldTurn } from 'safe-bash-contracts/yield';
import type { LlmInputSource } from './types.js';
import { validateAttachmentUrl } from './url-attachment.js';
import { waitForSource } from './request-source.js';

export interface LlmUrlSourceOptions {
  readonly url: string;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  readonly maxBytes?: number;
  /** Explicit redirect allowance; defaults to zero for attachment acquisition. */
  readonly maxRedirects?: number;
  /** Charge aggregate host input before a downloaded chunk is exposed or copied. */
  readonly admitBytes?: (bytes: number) => void;
}

/** A single-use remote input lease. Uses only the injected transport; downloads
 * are pulled on demand, never materialized, and redirects require an explicit allowance. */
export function createLlmUrlSource(options: LlmUrlSourceOptions): LlmInputSource {
  validateAttachmentUrl(options.url);
  const limit = options.maxBytes ?? Infinity;
  const maxRedirects = options.maxRedirects ?? 0;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new RangeError("Invalid URL redirect limit");
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Invalid URL input byte limit');
  if (typeof options.fetch !== 'function') throw new TypeError('Attachment URL loading is not configured');
  options.signal.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  inheritYieldCheckpoint(options.signal, signal);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false, consumed = false;
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    // The response can arrive after disposal. Do not cache an empty cleanup.
    if (!response) return Promise.resolve();
    return cancellation ??= Promise.resolve().then(() => reader ? reader.cancel() : response!.body?.cancel());
  };
  const abort = (): void => { void cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  const dispose = async (): Promise<void> => {
    closed = true;
    controller.abort(new FsError('EBADF', { message: 'LLM URL input is closed' }));
    signal.removeEventListener('abort', abort);
    const cleanup = cancel();
    if (options.signal.aborted) void cleanup.catch(() => undefined);
    else await cleanup;
  };
  return { dispose, bytes: { async *[Symbol.asyncIterator]() {
    if (closed || consumed) throw new FsError('EBADF', { message: 'LLM URL input is closed or consumed' });
    consumed = true;
    let failed = false, size = 0, windows = 0;
    try {
      signal.throwIfAborted();
      let url = options.url;
      for (let redirects = 0; ; redirects++) {
        await waitForSource(() => options.fetch(url, { method: 'GET', redirect: 'manual', signal }).then(value => {
          response = value;
          if (closed || signal.aborted) void cancel().catch(() => undefined);
          return value;
        }), signal);
        signal.throwIfAborted();
        const location = response!.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response!.status) || !location || maxRedirects === 0) break;
        if (redirects >= maxRedirects) throw new Error('Exceeded maximum allowed redirects.');
        const next = new URL(location, url).href;
        validateAttachmentUrl(next);
        await waitForSource(cancel, signal);
        response = undefined;
        cancellation = undefined;
        url = next;
      }
      if (!response!.ok) throw new Error(`Attachment URL returned HTTP ${response!.status}`);
      if (!response!.body) return;
      reader = response!.body.getReader();
      while (true) {
        const next = await waitForSource(() => reader!.read(), signal);
        if (next.done) return;
        if (!(next.value instanceof Uint8Array)) throw new TypeError('Attachment URL must return byte chunks');
        if (next.value.length > limit - size) throw new FsError('EFBIG', { message: 'Attachment URL input byte limit exceeded' });
        options.admitBytes?.(next.value.length);
        size += next.value.length;
        if (!next.value.length && ++windows % 64 === 0) await yieldTurn(signal);
        for (let offset = 0; offset < next.value.length; offset += 16384) {
          if (++windows % 64 === 0) await yieldTurn(signal);
          signal.throwIfAborted();
          yield next.value.slice(offset, offset + 16384);
        }
      }
    } catch (error) {
      failed = true;
      throw signal.aborted ? signal.reason : error;
    } finally {
      await dispose().catch(error => { if (!failed) throw error; });
      reader?.releaseLock();
    }
  } } };
}
