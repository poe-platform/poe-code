import { TransformStream } from "node:stream/web";
import { FsError } from "./errors.js";

export type ByteSource = AsyncIterable<Uint8Array>;

export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
}

export interface BytePipe {
  readonly readable: ByteSource;
  readonly writable: ByteSink;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface BytePipeOptions {
  readonly highWaterMark?: number;
  readonly signal?: AbortSignal;
}

export interface CollectOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export function createBytePipe(options: BytePipeOptions = {}): BytePipe {
  const highWaterMark = options.highWaterMark ?? 64 * 1024;
  if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 1) {
    throw new RangeError("highWaterMark must be a positive safe integer");
  }
  const stream = new TransformStream<Uint8Array, Uint8Array>(
    undefined,
    { highWaterMark: 1 },
    { highWaterMark, size: (chunk) => chunk.byteLength },
  );
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  let ended = false;
  let failed = false;
  let failure: unknown;
  let closePromise: Promise<void> | undefined;
  let abortPromise: Promise<void> | undefined;
  const abort = (reason: unknown = new FsError("EPIPE", { syscall: "pipe" })): Promise<void> => {
    if (abortPromise) return abortPromise;
    failed = true;
    failure = reason;
    ended = true;
    abortPromise = Promise.allSettled([reader.cancel(reason), writer.abort(reason)]).then(() => {});
    return abortPromise;
  };
  const onAbort = (): void => { void abort(options.signal?.reason); };
  const cleanup = (): void => options.signal?.removeEventListener("abort", onAbort);
  void writer.closed.then(cleanup, cleanup);
  void reader.closed.catch(() => {});
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  let finished = false;
  const iterator = (async function* (): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        if (failed) throw failure;
        const result = await reader.read();
        if (failed) throw failure;
        if (result.done) {
          finished = true;
          return;
        }
        yield result.value;
      }
    } finally {
      if (!finished) await abort();
      reader.releaseLock();
    }
  })();
  const readable: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() { return this; },
    next() { return iterator.next(); },
    async return() {
      if (!finished) await abort();
      try {
        return await iterator.return(undefined);
      } finally {
        reader.releaseLock();
      }
    },
    async throw(reason) {
      await abort(reason);
      try {
        return await iterator.throw(reason);
      } finally {
        reader.releaseLock();
      }
    },
  };
  return {
    readable,
    writable: {
      async write(chunk) {
        if (failed) throw failure;
        if (ended) throw new FsError("EPIPE", { syscall: "write" });
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
        if (chunk.byteLength > 0) await writer.write(new Uint8Array(chunk));
      },
    },
    close() {
      if (failed) return Promise.reject(failure);
      ended = true;
      closePromise ??= writer.close();
      return closePromise;
    },
    abort,
  };
}

export function toByteSource(input: string | Uint8Array): ByteSource {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return (async function* () {
    if (bytes.byteLength > 0) yield bytes;
  })();
}

export async function writeText(sink: ByteSink, text: string): Promise<void> {
  await sink.write(new TextEncoder().encode(text));
}

export async function pipeBytes(source: ByteSource, sink: ByteSink, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  for await (const chunk of source) {
    signal?.throwIfAborted();
    await sink.write(chunk);
  }
  signal?.throwIfAborted();
}

export async function collectBytes(source: ByteSource, options: CollectOptions): Promise<Uint8Array> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError("maxBytes must be a nonnegative safe integer");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  options.signal?.throwIfAborted();
  for await (const chunk of source) {
    options.signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
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

export async function collectText(source: ByteSource, options: CollectOptions): Promise<string> {
  return new TextDecoder().decode(await collectBytes(source, options));
}
