import { FsError } from "./errors.js";
import { finishCleanup } from "./cleanup.js";
import { platform } from "#safe-fs-platform";

export type ByteSource = AsyncIterable<Uint8Array>;

let sharedTextEncoder: TextEncoder | undefined;
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
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> } {
      let consumed = false;
      return {
        [Symbol.asyncIterator]() { return this; },
        tryNextSync(): IteratorResult<Uint8Array> {
          if (consumed) return DONE_RESULT;
          consumed = true;
          return { done: false, value: bytes };
        },
        next(): Promise<IteratorResult<Uint8Array>> {
          if (consumed) return RESOLVED_DONE;
          consumed = true;
          return Promise.resolve({ done: false, value: bytes });
        },
        return(): Promise<IteratorResult<Uint8Array>> {
          consumed = true;
          return RESOLVED_DONE;
        },
      };
    },
  };
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

export function readBytes(source: ByteSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (signal !== undefined && (source as { readonly [readBytesSignal]?: AbortSignal })[readBytesSignal] === signal) {
    return source as AsyncGenerator<Uint8Array>;
  }
  let iterator: (AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    abortSignal?: AbortSignal | undefined;
  }) | undefined;
  let nativeAbort = false;
  let finished = false;
  let closing: Promise<void> | undefined;
  let turn: Promise<void> | undefined;
  let readingSync = false;
  let syncFailure: { reason: unknown } | undefined;
  const schedule = <Result>(action: () => Promise<Result>): Promise<Result> => {
    const previous = turn;
    let release!: () => void;
    const reserved = new Promise<void>(resolve => { release = resolve; });
    turn = reserved;
    const result = previous ? previous.then(action) : readingSync ? Promise.resolve().then(action) : action();
    const finish = (): void => { if (turn === reserved) turn = undefined; release(); };
    void result.then(finish, finish);
    return result;
  };
  const ensureIterator = () => {
    if (!iterator) {
      signal?.throwIfAborted();
      iterator = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
        tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
        abortSignal?: AbortSignal | undefined;
      };
      nativeAbort = signal !== undefined && iterator.abortSignal === signal;
    }
    return iterator;
  };
  const cleanupIterator = async (failed: boolean): Promise<void> => {
    if (!finished && iterator?.return) {
      finished = true;
      const cleanup = Promise.resolve().then(() => iterator!.return!());
      if (signal?.aborted) void cleanup.catch(() => {});
      else closing = abortable(() => cleanup, signal).then(() => {});
    } else {
      finished = true;
    }
    if (closing) {
      const pending = closing;
      try { await finishCleanup(() => pending, failed); }
      finally { if (closing === pending) closing = undefined; }
    }
  };
  const tryNextSync = (): IteratorResult<Uint8Array> | undefined => {
    if (turn || readingSync || syncFailure) return undefined;
    if (finished) return DONE_RESULT;
    readingSync = true;
    try {
      const it = ensureIterator();
      if (typeof it.tryNextSync !== "function") return undefined;
      signal?.throwIfAborted();
      const syncResult = it.tryNextSync();
      if (syncResult === undefined) return undefined;
      if (syncResult.done) {
        finished = true;
        return DONE_RESULT;
      }
      if (!(syncResult.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      return syncResult;
    } catch (error) {
      syncFailure = { reason: error };
      return undefined;
    } finally {
      readingSync = false;
    }
  };
  const gen = {
    [readBytesSignal]: signal,
    abortSignal: signal,
    [Symbol.asyncIterator]() { return this; },
    tryNextSync,
    next(): Promise<IteratorResult<Uint8Array>> {
      return schedule(async () => {
        if (finished) return DONE_RESULT;
        try {
          if (syncFailure) {
            const { reason } = syncFailure;
            syncFailure = undefined;
            throw reason;
          }
          const it = ensureIterator();
          signal?.throwIfAborted();
          const syncResult = typeof it.tryNextSync === "function" ? it.tryNextSync() : undefined;
          const result = syncResult ?? (nativeAbort ? await it.next() : await abortable(() => it.next(), signal));
          signal?.throwIfAborted();
          if (result.done) {
            finished = true;
            return DONE_RESULT;
          }
          if (!(result.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
          return result;
        } catch (error) {
          await cleanupIterator(true);
          throw error;
        }
      });
    },
    return(value?: unknown): Promise<IteratorResult<Uint8Array>> {
      return schedule(async () => {
        await cleanupIterator(false);
        return { done: true, value: await value };
      });
    },
    throw(error: unknown): Promise<IteratorResult<Uint8Array>> {
      return schedule(async () => {
        await cleanupIterator(true);
        throw error;
      });
    },
  };
  return gen as unknown as AsyncGenerator<Uint8Array>;
}
