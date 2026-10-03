import { readBytes, compareIdentity, compareFileVersion, type FileReadHandle, type FileSystem, type FileStat, type FileStagingCleanup } from "@poe-code/safe-fs/contracts";
import { PdfError } from "./errors.js";

export interface PdfFileSourceOptions {
  /** Maximum individual request and cache page size; defaults to 64 KiB. */
  readonly chunkBytes?: number;
  /** Resident range cache budget; defaults to 256 KiB. Must hold one page. */
  readonly cacheBytes?: number;
  /** Input admission limit, checked against the retained handle before reading. */
  readonly maxInputBytes?: number;
  readonly signal?: AbortSignal;
  /** Optional sealed content receipt; checked at acquisition and around reads. */
  readonly expected?: FileStat;
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function sourceLimits(options: PdfFileSourceOptions) {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const cacheBytes = options.cacheBytes ?? 256 * 1024;
  nonnegativeInteger(chunkBytes, "chunkBytes");
  nonnegativeInteger(cacheBytes, "cacheBytes");
  if (chunkBytes === 0 || cacheBytes < chunkBytes) {
    throw new RangeError("cacheBytes must hold at least one nonempty chunk");
  }
  const maxInputBytes = options.maxInputBytes ?? Infinity;
  if (maxInputBytes !== Infinity) nonnegativeInteger(maxInputBytes, "maxInputBytes");
  return { chunkBytes, cacheBytes, maxInputBytes };
}

function verifyReceipt(actual: FileStat, expected: FileStat): void {
  if (compareIdentity(actual, expected) !== "same" || !compareFileVersion(actual, expected)) {
    throw new PdfError("E_CAPABILITY", "Retained PDF source changed after sealing");
  }
}

async function disposeStaging(cleanup: FileStagingCleanup, failed: boolean): Promise<void> {
  let failure: { error: unknown } | undefined;
  try { await cleanup.remove(); } catch (error) { failure = { error }; }
  try { await cleanup.close(); } catch (error) { failure ??= { error }; }
  if (!failed && failure) throw failure.error;
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
  private stagingCleanup: FileStagingCleanup | undefined;

  private constructor(
    private readonly handle: FileReadHandle,
    readonly size: number,
    readonly chunkBytes: number,
    private readonly cachePages: number,
    private readonly signal: AbortSignal | undefined,
    private readonly expected: FileStat | undefined,
  ) {}

  static async open(fs: FileSystem, path: string, options: PdfFileSourceOptions = {}): Promise<PdfFileSource> {
    const { chunkBytes, cacheBytes, maxInputBytes } = sourceLimits(options);
    const { signal } = options;
    const expected = options.expected === undefined ? undefined : { ...options.expected };
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
      if (expected) verifyReceipt(stat, expected);
      nonnegativeInteger(stat.size, "file size");
      if (stat.size > maxInputBytes) throw new PdfError("E_LIMIT", "PDF input byte limit exceeded");
      return new PdfFileSource(handle, stat.size, chunkBytes, Math.floor(cacheBytes / chunkBytes), signal, expected);
    } catch (error) {
      // Acquisition owns the handle even when admission or cancellation fails.
      try { await handle.close(); } catch { /* Preserve the primary failure. */ }
      throw error;
    }
  }

  /** Spool only into caller-authorized retained staging; close owns its removal. */
  static async fromStream(fs: FileSystem, directory: string, input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: Omit<PdfFileSourceOptions, "expected"> = {}): Promise<PdfFileSource> {
    const { chunkBytes, maxInputBytes } = sourceLimits(options);
    const { signal } = options;
    const io = signal === undefined ? {} : { signal };
    signal?.throwIfAborted();
    const capabilities = await fs.capabilitiesFor?.(directory, { ...io, create: true }) ?? fs.capabilities;
    signal?.throwIfAborted();
    if (!capabilities.retainedStagingCleanup || !capabilities.retainedStagingWrite || !capabilities.retainedRead || !fs.createStagedFile || !fs.openReadFile) {
      throw new PdfError("E_CAPABILITY", "PDF staging requires caller filesystem retained staging and reads");
    }
    const parent = await fs.stat(directory, io);
    signal?.throwIfAborted();
    if (parent.type !== "directory") throw new PdfError("E_CAPABILITY", "PDF staging parent must be a directory");
    const root = directory.endsWith("/") ? directory : `${directory}/`;
    const staging = await fs.createStagedFile(`${root}.pdf-${crypto.randomUUID()}`, "bytes", { type: "file", data: new Uint8Array(0) },
      { ...io, parent, mode: 0o600, retainCleanup: true });
    try {
      signal?.throwIfAborted();
      if (!staging.writer || !staging.cleanup) throw new PdfError("E_CAPABILITY", "PDF backend omitted retained staging handles");
      let written = 0;
      const stream: AsyncIterable<Uint8Array> = Symbol.asyncIterator in input
        ? input : { async *[Symbol.asyncIterator]() { yield* input; } };
      for await (const bytes of readBytes(stream, signal)) {
        signal?.throwIfAborted();
        if (bytes.length > Math.min(maxInputBytes, Number.MAX_SAFE_INTEGER) - written) {
          throw new PdfError("E_LIMIT", "PDF input byte limit exceeded");
        }
        for (let position = 0; position < bytes.length; position += chunkBytes) {
          signal?.throwIfAborted();
          // Detach bounded writes from reusable or oversized source backing buffers.
          const chunk = new Uint8Array(bytes.subarray(position, Math.min(bytes.length, position + chunkBytes)));
          await staging.writer.write(chunk, io);
          signal?.throwIfAborted();
        }
        written += bytes.length;
      }
      signal?.throwIfAborted();
      const expected = await staging.writer.finish(io);
      signal?.throwIfAborted();
      if (expected.type !== "file" || expected.size !== written) throw new PdfError("E_CAPABILITY", "PDF staging size mismatch");
      const source = await PdfFileSource.open(fs, staging.file.path, { ...options, expected });
      source.stagingCleanup = staging.cleanup;
      return source;
    } catch (error) {
      if (staging.cleanup) await disposeStaging(staging.cleanup, true);
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
      if (this.expected) {
        verifyReceipt(await this.handle.stat(io), this.expected);
        activeSignal?.throwIfAborted();
      }
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
            if (this.expected) {
              verifyReceipt(await this.handle.stat(io), this.expected);
              activeSignal?.throwIfAborted();
            }
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
      let failure: { error: unknown } | undefined;
      try { await this.handle.close(); } catch (error) { failure = { error }; }
      if (this.stagingCleanup) {
        try { await disposeStaging(this.stagingCleanup, failure !== undefined); }
        catch (error) { failure ??= { error }; }
      }
      if (failure) throw failure.error;
    });
    return this.closing;
  }
}
