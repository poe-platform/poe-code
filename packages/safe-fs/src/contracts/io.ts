import { FsError } from "./errors.js";
import { finishCleanup } from "./cleanup.js";
import { platform } from "#safe-fs-platform";

export type ByteSource = AsyncIterable<Uint8Array>;

let sharedTextEncoder: InstanceType<typeof TextEncoder> | undefined;
const EMPTY_BYTES = new Uint8Array(0);
const DONE_RESULT: IteratorResult<Uint8Array> = Object.freeze({ done: true, value: undefined });
const RESOLVED_DONE: Promise<IteratorResult<Uint8Array>> = Promise.resolve(DONE_RESULT);
const readBytesSignal = Symbol.for("safe-fs.readBytesSignal");
const EMPTY_BYTE_ITERATOR: AsyncIterableIterator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> } = Object.freeze({
  [Symbol.asyncIterator]() { return this; },
  tryNextSync() { return DONE_RESULT; },
  next() { return RESOLVED_DONE; },
  return() { return RESOLVED_DONE; },
});
const EMPTY_BYTE_SOURCE: ByteSource = Object.freeze({
  [Symbol.asyncIterator]() { return EMPTY_BYTE_ITERATOR; },
});
const noop = (): void => {};

class SingleChunkByteIterator implements AsyncIterableIterator<Uint8Array> {
  declare readonly bytes: Uint8Array;
  declare consumed: boolean;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.consumed = false;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  tryNextSync(): IteratorResult<Uint8Array> {
    if (this.consumed) return DONE_RESULT;
    this.consumed = true;
    return { done: false, value: this.bytes };
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    if (this.consumed) return RESOLVED_DONE;
    this.consumed = true;
    return Promise.resolve({ done: false, value: this.bytes });
  }

  return(): Promise<IteratorResult<Uint8Array>> {
    this.consumed = true;
    return RESOLVED_DONE;
  }
}

class SingleChunkByteSource implements ByteSource {
  declare readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  [Symbol.asyncIterator](): SingleChunkByteIterator {
    return new SingleChunkByteIterator(this.bytes);
  }
}

export interface CollectOptions {
  readonly maxBytes?: number;
  /** Owned capacity, current input backing storage, and replacement allocation peak. */
  readonly maxMemoryBytes?: number;
  readonly signal?: AbortSignal;
}

export function toByteSource(input: string | Uint8Array): ByteSource {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new TypeError("Byte source input must be a string or Uint8Array");
  }
  if (typeof input === "string") {
    if (input.length === 0) return EMPTY_BYTE_SOURCE;
  } else if (input.byteLength === 0) {
    return EMPTY_BYTE_SOURCE;
  }
  const bytes = typeof input === "string" ? (sharedTextEncoder ??= new TextEncoder()).encode(input) : new Uint8Array(input);
  return new SingleChunkByteSource(bytes);
}

let activeCollectionBytes = 0;

export async function collectBytes(source: ByteSource, options: CollectOptions): Promise<Uint8Array> {
  if (options.maxBytes !== undefined && options.maxBytes !== Infinity && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)) {
    throw new RangeError("maxBytes must be a nonnegative safe integer");
  }
  if (options.maxMemoryBytes !== undefined && (!Number.isSafeInteger(options.maxMemoryBytes) || options.maxMemoryBytes < 0)) {
    throw new RangeError("maxMemoryBytes must be a nonnegative safe integer");
  }
  const memoryLimit = options.maxMemoryBytes ?? Infinity;
  let reserved = 0;
  let inputBytes = 0;
  let buffer = new Uint8Array(0);
  let size = 0;
  function reserve(bytes: number): void {
    if (bytes > memoryLimit - reserved || bytes > platform.maxCollectionBytes - activeCollectionBytes) {
      throw new FsError("EFBIG", { syscall: "collectBytes", message: "collection exceeds memory budget" });
    }
    reserved += bytes;
    activeCollectionBytes += bytes;
  }
  try {
    options.signal?.throwIfAborted();
    for await (const chunk of readBytes(source, options.signal)) {
      activeCollectionBytes -= inputBytes;
      reserved -= inputBytes;
      inputBytes = 0;
      if (chunk.byteLength > (options.maxBytes ?? Infinity) - size) {
        throw new FsError("EFBIG", { syscall: "collectBytes", message: "output exceeds maxBytes" });
      }
      // A small view can retain a large backing buffer. Keep this reservation
      // while awaiting the next chunk, including while its source is suspended.
      reserve(chunk.buffer.byteLength);
      inputBytes = chunk.buffer.byteLength;
      const nextSize = size + chunk.byteLength;
      if (nextSize > buffer.byteLength) {
        const capacity = Math.min(options.maxBytes ?? Infinity, Math.max(nextSize, buffer.byteLength * 2));
        // Admit both generations before allocation. Do not fall back to repeated
        // exact-size growth when geometric growth exceeds the budget.
        reserve(capacity);
        const replacement = new Uint8Array(capacity);
        replacement.set(buffer.subarray(0, size));
        activeCollectionBytes -= buffer.byteLength;
        reserved -= buffer.byteLength;
        buffer = replacement;
      }
      buffer.set(chunk, size);
      size = nextSize;
    }
    options.signal?.throwIfAborted();
    return buffer.subarray(0, size);
  } finally {
    activeCollectionBytes -= reserved;
  }
}

async function abortable<Result>(operation: () => PromiseLike<Result>, signal?: AbortSignal): Promise<Result> {
  signal?.throwIfAborted();
  if (!signal) return operation();
  return new Promise<Result>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      Promise.resolve(operation()).then(
        (result) => {
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    }
  });
}

class ReadBytesGenerator {
  declare readonly source: ByteSource;
  declare readonly abortSignal: AbortSignal | undefined;
  declare iterator: (AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    abortSignal?: AbortSignal | undefined;
  }) | undefined;
  declare nativeAbort: boolean;
  declare finished: boolean;
  declare closing: Promise<void> | undefined;
  declare turn: Promise<unknown> | undefined;
  declare readingSync: boolean;
  declare syncFailure: { reason: unknown } | undefined;

  constructor(source: ByteSource, signal?: AbortSignal) {
    this.source = source;
    this.abortSignal = signal;
    this.iterator = undefined;
    this.nativeAbort = false;
    this.finished = false;
    this.closing = undefined;
    this.turn = undefined;
    this.readingSync = false;
    this.syncFailure = undefined;
  }

  get [readBytesSignal](): AbortSignal | undefined {
    return this.abortSignal;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  _schedule<Result>(action: () => Promise<Result>): Promise<Result> {
    const previous = this.turn;
    let release!: () => void;
    const reserved = new Promise<void>(resolve => { release = resolve; });
    // Reserve before calling a producer, which may synchronously reenter us.
    this.turn = reserved;
    const result = previous
      ? previous.then(action)
      : this.readingSync
        ? Promise.resolve().then(action)
        : action();
    const finish = (): void => {
      if (this.turn === reserved) this.turn = undefined;
      release();
    };
    void result.then(finish, finish);
    return result;
  }

  _ensureIterator() {
    let it = this.iterator;
    if (!it) {
      const signal = this.abortSignal;
      signal?.throwIfAborted();
      it = this.source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
        tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
        abortSignal?: AbortSignal | undefined;
      };
      this.iterator = it;
      this.nativeAbort = signal !== undefined && it.abortSignal === signal;
    }
    return it;
  }

  async _cleanupIterator(failed: boolean): Promise<void> {
    const signal = this.abortSignal;
    if (!this.finished && this.iterator?.return) {
      this.finished = true;
      const it = this.iterator;
      const cleanup = Promise.resolve().then(() => it.return!());
      if (signal?.aborted) void cleanup.catch(noop);
      else this.closing = abortable(() => cleanup, signal).then(noop);
    } else {
      this.finished = true;
    }
    if (this.closing) {
      const pending = this.closing;
      try { await finishCleanup(() => pending, failed); }
      finally { if (this.closing === pending) this.closing = undefined; }
    }
  }

  tryNextSync(): IteratorResult<Uint8Array> | undefined {
    if (this.turn || this.readingSync || this.syncFailure) return undefined;
    if (this.finished) return DONE_RESULT;
    this.readingSync = true;
    try {
      const it = this._ensureIterator();
      if (typeof it.tryNextSync !== "function") return undefined;
      const signal = this.abortSignal;
      signal?.throwIfAborted();
      const syncResult = it.tryNextSync();
      signal?.throwIfAborted();
      if (syncResult === undefined) return undefined;
      if (syncResult.done) {
        this.finished = true;
        return DONE_RESULT;
      }
      if (!(syncResult.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      return syncResult;
    } catch (error) {
      this.syncFailure = { reason: error };
      return undefined;
    } finally {
      this.readingSync = false;
    }
  }

  async _runNext(): Promise<IteratorResult<Uint8Array>> {
    if (this.finished) return DONE_RESULT;
    try {
      if (this.syncFailure) {
        const { reason } = this.syncFailure;
        this.syncFailure = undefined;
        throw reason;
      }
      const it = this._ensureIterator();
      const signal = this.abortSignal;
      signal?.throwIfAborted();
      const syncResult = typeof it.tryNextSync === "function" ? it.tryNextSync() : undefined;
      const result = syncResult ?? (this.nativeAbort ? await it.next() : await abortable(() => it.next(), signal));
      signal?.throwIfAborted();
      if (result.done) {
        this.finished = true;
        return DONE_RESULT;
      }
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      return result;
    } catch (error) {
      await this._cleanupIterator(true);
      throw error;
    }
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    if (this.finished && !this.turn && !this.readingSync && !this.syncFailure && !this.closing) return RESOLVED_DONE;
    return this._schedule(() => this._runNext());
  }

  return(value?: unknown): Promise<IteratorResult<Uint8Array>> {
    if ((this.finished || !this.iterator?.return) && !this.turn && !this.readingSync && !this.closing && value === undefined) {
      this.finished = true;
      return RESOLVED_DONE;
    }
    return this._schedule(async () => {
      await this._cleanupIterator(false);
      return { done: true, value: await value };
    });
  }

  throw(error: unknown): Promise<IteratorResult<Uint8Array>> {
    return this._schedule(async () => {
      await this._cleanupIterator(true);
      throw error;
    });
  }
}

export function readBytes(source: ByteSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (signal !== undefined && (source as { readonly [readBytesSignal]?: AbortSignal })[readBytesSignal] === signal) {
    return source as AsyncGenerator<Uint8Array>;
  }
  return new ReadBytesGenerator(source, signal) as unknown as AsyncGenerator<Uint8Array>;
}
