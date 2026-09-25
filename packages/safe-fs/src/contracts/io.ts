import { FsError } from "./errors.js";
import { finishCleanup } from "./cleanup.js";
import { platform } from "#safe-fs-platform";

export type ByteSource = AsyncIterable<Uint8Array>;

let sharedTextEncoder: TextEncoder | undefined;
const EMPTY_BYTES = new Uint8Array(0);
const DONE_RESULT: IteratorResult<Uint8Array> = Object.freeze({ done: true, value: undefined });
const RESOLVED_DONE: Promise<IteratorResult<Uint8Array>> = Promise.resolve(DONE_RESULT);
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

export async function* readBytes(source: ByteSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    abortSignal?: AbortSignal | undefined;
  };
  const nativeAbort = signal !== undefined && iterator.abortSignal === signal;
  let finished = false;
  let failed = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const syncResult = typeof iterator.tryNextSync === "function" ? iterator.tryNextSync() : undefined;
      const result = syncResult ?? (nativeAbort ? await iterator.next() : await abortable(() => iterator.next(), signal));
      if (result.done) {
        finished = true;
        return;
      }
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      yield result.value;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!finished && iterator.return) {
      const cleanup = Promise.resolve().then(() => iterator.return!());
      if (signal?.aborted) void cleanup.catch(() => {});
      else await finishCleanup(() => abortable(() => cleanup, signal), failed);
    }
  }
}
