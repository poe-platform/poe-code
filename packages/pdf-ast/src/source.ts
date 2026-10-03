import type { FileReadHandle, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfError } from "./errors.js";

export interface PdfFileSourceOptions {
  /** Maximum individual request and cache page size; defaults to 64 KiB. */
  readonly chunkBytes?: number;
  /** Resident range cache budget; defaults to 256 KiB. Must hold one page. */
  readonly cacheBytes?: number;
  /** Input admission limit, checked against the retained handle before reading. */
  readonly maxInputBytes?: number;
  readonly signal?: AbortSignal;
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

/**
 * Random access to one retained safe-fs object, with no pathname reopen or
 * whole-file fallback. Returned chunks are caller-owned. Resident working
 * storage is cacheBytes plus at most three chunkBytes (result, fill and backend
 * response); bytes retained by callers or the injected backend are additional.
 * Retained identity does not turn mutable file contents into a snapshot.
 */
export class PdfFileSource {
  private readonly cache = new Map<number, Uint8Array>();
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly handle: FileReadHandle,
    readonly size: number,
    readonly chunkBytes: number,
    private readonly cachePages: number,
    private readonly signal: AbortSignal | undefined,
  ) {}

  static async open(fs: FileSystem, path: string, options: PdfFileSourceOptions = {}): Promise<PdfFileSource> {
    const chunkBytes = options.chunkBytes ?? 64 * 1024;
    const cacheBytes = options.cacheBytes ?? 256 * 1024;
    nonnegativeInteger(chunkBytes, "chunkBytes");
    nonnegativeInteger(cacheBytes, "cacheBytes");
    if (chunkBytes === 0 || cacheBytes < chunkBytes) {
      throw new RangeError("cacheBytes must hold at least one nonempty chunk");
    }
    const maxInputBytes = options.maxInputBytes ?? Infinity;
    if (maxInputBytes !== Infinity) nonnegativeInteger(maxInputBytes, "maxInputBytes");
    const { signal } = options;
    const io = signal === undefined ? {} : { signal };
    signal?.throwIfAborted();
    const capabilities = await fs.capabilitiesFor?.(path, io) ?? fs.capabilities;
    signal?.throwIfAborted();
    if (capabilities.retainedRead !== true || !fs.openReadFile) {
      throw new PdfError("E_CAPABILITY", "PDF range access requires retained safe-fs reads");
    }
    const handle = await fs.openReadFile(path, io);
    try {
      signal?.throwIfAborted();
      const stat = await handle.stat(io);
      signal?.throwIfAborted();
      if (stat.type !== "file") throw new PdfError("E_CAPABILITY", "PDF source must be a regular file");
      nonnegativeInteger(stat.size, "file size");
      if (stat.size > maxInputBytes) throw new PdfError("E_LIMIT", "PDF input byte limit exceeded");
      return new PdfFileSource(handle, stat.size, chunkBytes, Math.floor(cacheBytes / chunkBytes), signal);
    } catch (error) {
      // Acquisition owns the handle even when admission or cancellation fails.
      try { await handle.close(); } catch { /* Preserve the primary failure. */ }
      throw error;
    }
  }

  /** Read at most chunkBytes. Short reads occur only at the admitted file end. */
  async read(position: number, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    nonnegativeInteger(position, "position");
    nonnegativeInteger(maxBytes, "maxBytes");
    if (maxBytes > this.chunkBytes) throw new PdfError("E_LIMIT", "PDF range exceeds chunk byte limit");
    if (this.closing) throw new PdfError("E_CAPABILITY", "PDF source is closed");
    const operation = this.pending.then(async () => {
      this.signal?.throwIfAborted();
      signal?.throwIfAborted();
      const activeSignal = this.signal && signal ? AbortSignal.any([this.signal, signal]) : signal ?? this.signal;
      const io = activeSignal === undefined ? {} : { signal: activeSignal };
      const length = Math.min(maxBytes, Math.max(0, this.size - position));
      const result = new Uint8Array(length);
      let copied = 0;
      while (copied < length) {
        activeSignal?.throwIfAborted();
        const offset = position + copied;
        const pageStart = Math.floor(offset / this.chunkBytes) * this.chunkBytes;
        let page = this.cache.get(pageStart);
        if (page) {
          this.cache.delete(pageStart);
          this.cache.set(pageStart, page);
        } else {
          // Evict before allocation, including when the previous request failed.
          if (this.cache.size >= this.cachePages) this.cache.delete(this.cache.keys().next().value!);
          page = new Uint8Array(Math.min(this.chunkBytes, this.size - pageStart));
          let filled = 0;
          while (filled < page.length) {
            activeSignal?.throwIfAborted();
            const bytes = await this.handle.read(pageStart + filled, page.length - filled, io);
            activeSignal?.throwIfAborted();
            if (bytes.length === 0) throw new PdfError("E_PARSE", "Unexpected end of retained PDF source");
            if (bytes.length > page.length - filled) {
              throw new PdfError("E_CAPABILITY", "PDF backend exceeded requested range");
            }
            page.set(bytes, filled);
            filled += bytes.length;
          }
          this.cache.set(pageStart, page);
        }
        const from = offset - pageStart;
        const count = Math.min(length - copied, page.length - from);
        result.set(page.subarray(from, from + count), copied);
        copied += count;
      }
      return result;
    });
    // A failed request must neither poison later requests nor retain its result.
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  /** Pull-based range streaming: one read per consumer request, no read-ahead. */
  async *stream(position = 0, length = this.size - position, signal?: AbortSignal): AsyncGenerator<Uint8Array, void, void> {
    this.signal?.throwIfAborted();
    signal?.throwIfAborted();
    if (this.closing) throw new PdfError("E_CAPABILITY", "PDF source is closed");
    nonnegativeInteger(position, "position");
    nonnegativeInteger(length, "length");
    if (position > this.size || length > this.size - position) throw new RangeError("PDF stream range exceeds file size");
    let remaining = length;
    while (remaining > 0) {
      const bytes = await this.read(position, Math.min(remaining, this.chunkBytes), signal);
      yield bytes;
      position += bytes.length;
      remaining -= bytes.length;
    }
  }

  /** Accepted reads finish before closing; subsequent requests are rejected. */
  close(): Promise<void> {
    this.closing ??= this.pending.then(async () => {
      this.cache.clear();
      await this.handle.close();
    });
    return this.closing;
  }
}
