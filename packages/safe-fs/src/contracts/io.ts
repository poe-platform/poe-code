import { FsError } from "./errors.js";
import { finishCleanup } from "./cleanup.js";

export type ByteSource = AsyncIterable<Uint8Array>;

export interface CollectOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export function toByteSource(input: string | Uint8Array): ByteSource {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new TypeError("Byte source input must be a string or Uint8Array");
  }
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return (async function* () {
    if (bytes.byteLength > 0) yield bytes;
  })();
}

export async function collectBytes(source: ByteSource, options: CollectOptions): Promise<Uint8Array> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError("maxBytes must be a nonnegative safe integer");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  options.signal?.throwIfAborted();
  for await (const chunk of readBytes(source, options.signal)) {
    if (chunk.byteLength > options.maxBytes - size) {
      throw new FsError("EFBIG", { syscall: "collectBytes", message: "output exceeds maxBytes" });
    }
    if (chunk.byteLength > 0) chunks.push(new Uint8Array(chunk));
    size += chunk.byteLength;
  }
  options.signal?.throwIfAborted();
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
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
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;
  let failed = false;
  try {
    while (true) {
      const result = await abortable(() => iterator.next(), signal);
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
