import { collectBytes, readBytes } from "poe-code/safe-fs";
import type { ByteSource, CollectOptions } from "poe-code/safe-fs";
export { collectBytes, readBytes, toByteSource } from "poe-code/safe-fs";
export type { ByteSource, CollectOptions } from "poe-code/safe-fs";
import { TransformStream } from "node:stream/web";
import { FsError } from "./errors.js";

export const outputFailure = Symbol("output failure");

export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  readonly [outputFailure]?: (reason: unknown) => Promise<void>;
  readonly ownedOutput?: {
    readonly consumerClosed: AbortSignal;
    write(chunk: Uint8Array): Promise<void>;
  };
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

export function createBytePipe(options: BytePipeOptions = {}): BytePipe {
  const highWaterMark = options.highWaterMark ?? 64 * 1024;
  const signal = options.signal;
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
  let finished = false;
  const consumer = new AbortController();
  const abort = (reason: unknown = new FsError("EPIPE", { syscall: "pipe" })): Promise<void> => {
    if (abortPromise) return abortPromise;
    if (finished) return Promise.resolve();
    failed = true;
    failure = reason;
    ended = true;
    consumer.abort(reason);
    abortPromise = Promise.allSettled([reader.cancel(reason), writer.abort(reason)]).then(() => {});
    return abortPromise;
  };
  const onAbort = (): void => { void abort(signal?.reason); };
  const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
  void writer.closed.catch(() => {});
  void reader.closed.then(cleanup, cleanup);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
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
  const write = async (chunk: Uint8Array): Promise<void> => {
    if (failed) throw failure;
    if (ended) throw new FsError("EPIPE", { syscall: "write" });
    if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
    if (chunk.byteLength > 0) await writer.write(new Uint8Array(chunk));
  };
  return {
    readable,
    writable: {
      write,
      [outputFailure]: abort,
      ownedOutput: { consumerClosed: consumer.signal, write },
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

export async function writeText(sink: ByteSink, text: string): Promise<void> {
  await sink.write(new TextEncoder().encode(text));
}

export async function writeBytes(sink: ByteSink, chunk: Uint8Array, signal?: AbortSignal): Promise<void> {
  if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
  await abortable(() => sink.write(chunk), signal);
}

export async function pipeBytes(source: ByteSource, sink: ByteSink, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  for await (const chunk of readBytes(source, signal)) {
    await writeBytes(sink, chunk, signal);
  }
  signal?.throwIfAborted();
}

export async function collectText(source: ByteSource, options: CollectOptions): Promise<string> {
  return new TextDecoder().decode(await collectBytes(source, options));
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
