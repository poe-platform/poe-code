import { collectBytes, readBytes } from "@poe-code/safe-fs/core";
import type { ByteSource, CollectOptions } from "@poe-code/safe-fs/core";
export { collectBytes, readBytes, toByteSource } from "@poe-code/safe-fs/core";
export type { ByteSource, CollectOptions } from "@poe-code/safe-fs/core";
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
  readonly endpoints?: { readonly read: PipeReadEndpoint; readonly write: PipeWriteEndpoint };
  readiness(): "ready" | "eof" | "blocked";
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface PipeEndpointObservation {
  readonly revision: bigint;
  readonly ready: boolean;
  readonly peerClosed: boolean;
}

export interface PipeEndpointWaitOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

interface PipeEndpoint {
  probe(): PipeEndpointObservation;
  waitForChange(revision: bigint, options: PipeEndpointWaitOptions): Promise<PipeEndpointObservation | undefined>;
  close(): Promise<void>;
}

export interface PipeReadEndpoint extends PipeEndpoint {
  readonly direction: "read";
  readonly readable: ByteSource;
  acquire(): PipeReadEndpoint;
}

export interface PipeWriteEndpoint extends PipeEndpoint {
  readonly direction: "write";
  readonly writable: ByteSink;
  acquire(): PipeWriteEndpoint;
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
  interface EndpointState {
    readonly direction: "read" | "write";
    readonly writes: Set<WriteRequest>;
    open: boolean;
    closing: Promise<void> | undefined;
  }
  interface ReadLease {
    readonly endpoint: EndpointState;
    readonly pending: Set<ReadRequest>;
    done: boolean;
  }
  interface ReadRequest {
    readonly lease: ReadLease;
    readonly resolve: (result: IteratorResult<Uint8Array>) => void;
    readonly reject: (reason: unknown) => void;
  }
  interface WriteRequest {
    readonly endpoint: EndpointState;
    readonly chunk: Uint8Array;
    readonly completion: Promise<void>;
    readonly resolve: () => void;
    readonly reject: (reason: unknown) => void;
  }
  interface ObservationWaiter { changed(): void; aborted(reason: unknown): void; }
  const maximumObservationWaiters = 64;
  const buffered = new Set<Uint8Array>();
  const reads = new Set<ReadRequest>();
  const writes = new Set<WriteRequest>();
  const observers = new Set<ObservationWaiter>();
  let availableBytes = 0;
  let readerReferences = 0;
  let writerReferences = 0;
  let revision = 0n;
  let failed = false;
  let failure: unknown;
  let closePromise: Promise<void> | undefined;
  let abortPromise: Promise<void> | undefined;
  let finished = false;
  const consumer = new AbortController();
  const brokenPipe = (): FsError => new FsError("EPIPE", { syscall: "pipe" });
  const checkFailure = (): void => { if (failed) throw failure; };
  const checkEndpoint = (endpoint: EndpointState): void => {
    checkFailure();
    signal?.throwIfAborted();
    if (!endpoint.open) throw new FsError("EBADF", { syscall: "pipe" });
  };
  const changed = (): void => {
    revision++;
    for (const observer of [...observers]) observer.changed();
  };
  const removeRead = (request: ReadRequest): void => {
    reads.delete(request);
    request.lease.pending.delete(request);
  };
  const removeWrite = (request: WriteRequest): void => {
    writes.delete(request);
    request.endpoint.writes.delete(request);
  };
  const cleanup = (): void => { if (!observers.size) signal?.removeEventListener("abort", onAbort); };
  const pump = (): void => {
    if (failed) return;
    while (true) {
      const reading = reads.values().next().value as ReadRequest | undefined;
      const chunk = buffered.values().next().value as Uint8Array | undefined;
      if (reading && chunk) {
        removeRead(reading);
        buffered.delete(chunk);
        availableBytes -= chunk.byteLength;
        reading.resolve({ done: false, value: chunk });
        changed();
        continue;
      }
      const writing = writes.values().next().value as WriteRequest | undefined;
      if (writing && (reading || availableBytes < highWaterMark)) {
        removeWrite(writing);
        buffered.add(writing.chunk);
        availableBytes += writing.chunk.byteLength;
        writing.resolve();
        changed();
        continue;
      }
      if (!writerReferences && !writes.size && !buffered.size && reads.size) {
        finished = true;
        for (const request of reads) {
          removeRead(request);
          request.lease.done = true;
          request.resolve({ done: true, value: undefined });
        }
        cleanup();
      }
      break;
    }
  };
  const fail = (reason: unknown): Promise<void> => {
    if (abortPromise) return abortPromise;
    if (finished) {
      for (const observer of [...observers]) observer.aborted(reason);
      return Promise.resolve();
    }
    abortPromise = Promise.resolve();
    failed = true;
    failure = reason;
    buffered.clear();
    availableBytes = 0;
    for (const request of reads) {
      removeRead(request);
      request.lease.done = true;
      request.reject(reason);
    }
    for (const request of writes) {
      removeWrite(request);
      request.reject(reason);
    }
    consumer.abort(reason);
    changed();
    cleanup();
    return abortPromise;
  };
  const abort = (reason: unknown = new FsError("EPIPE", { syscall: "pipe" })): Promise<void> => fail(reason);
  const onAbort = (): void => { void fail(signal?.reason); };
  const probe = (endpoint: EndpointState): PipeEndpointObservation => {
    checkEndpoint(endpoint);
    const peerClosed = endpoint.direction === "read" ? writerReferences === 0 : readerReferences === 0;
    return Object.freeze({ revision, ready: peerClosed || endpoint.direction === "read" && availableBytes > 0, peerClosed });
  };
  const waitForChange = (endpoint: EndpointState, previous: bigint, options: PipeEndpointWaitOptions): Promise<PipeEndpointObservation | undefined> => {
    try {
      const { signal: waitingSignal, timeoutMs } = options;
      const localSignal = waitingSignal === signal ? undefined : waitingSignal;
      checkFailure();
      signal?.throwIfAborted();
      waitingSignal?.throwIfAborted();
      checkEndpoint(endpoint);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) throw new RangeError("timeoutMs must be an integer between zero and 2147483647");
      if (typeof previous !== "bigint" || previous < 0n || previous > revision) throw new RangeError("Invalid pipe observation revision");
      if (previous !== revision) return Promise.resolve(probe(endpoint));
      if (!timeoutMs) return Promise.resolve(undefined);
      if (observers.size >= maximumObservationWaiters) throw new RangeError("Too many pending pipe endpoint observations");
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const retire = (): boolean => {
          if (settled) return false;
          settled = true;
          observers.delete(observer);
          if (timer !== undefined) clearTimeout(timer);
          localSignal?.removeEventListener("abort", interrupted);
          if (finished || failed || !readerReferences && !writerReferences) cleanup();
          return true;
        };
        const settle = (timedOut = false): void => {
          if (!retire()) return;
          try {
            checkFailure();
            signal?.throwIfAborted();
            waitingSignal?.throwIfAborted();
            checkEndpoint(endpoint);
            resolve(timedOut ? undefined : probe(endpoint));
          } catch (reason) { reject(reason); }
        };
        const interrupted = (): void => settle();
        const observer: ObservationWaiter = {
          changed: () => settle(),
          aborted(reason) { if (retire()) reject(signal?.aborted ? signal.reason : reason); },
        };
        observers.add(observer);
        try {
          signal?.addEventListener("abort", onAbort, { once: true });
          localSignal?.addEventListener("abort", interrupted, { once: true });
          if (settled) {
            localSignal?.removeEventListener("abort", interrupted);
            if (finished || failed || !readerReferences && !writerReferences) cleanup();
          }
          if (signal?.aborted || waitingSignal?.aborted || revision !== previous || !endpoint.open || failed) settle();
          if (!settled) timer = setTimeout(() => settle(true), timeoutMs);
        } catch (reason) { if (retire()) reject(reason); }
      });
    } catch (reason) { return Promise.reject(reason); }
  };
  const closeEndpoint = (endpoint: EndpointState): Promise<void> => {
    if (endpoint.closing) return endpoint.closing;
    let closed!: () => void;
    endpoint.closing = new Promise(resolve => { closed = resolve; });
    endpoint.open = false;
    const admittedWrites = [...endpoint.writes].map(request => request.completion);
    if (endpoint.direction === "read") {
      readerReferences--;
      for (const request of reads) if (request.lease.endpoint === endpoint) {
        removeRead(request);
        request.lease.done = true;
        request.reject(failed ? failure : new FsError("EBADF", { syscall: "read" }));
      }
      if (!readerReferences) {
        buffered.clear();
        availableBytes = 0;
        const reason = brokenPipe();
        for (const request of writes) {
          removeWrite(request);
          request.reject(failed ? failure : reason);
        }
        consumer.abort(reason);
      }
    } else writerReferences--;
    changed();
    pump();
    if (!readerReferences && !writerReferences) cleanup();
    void Promise.allSettled(admittedWrites).then(closed);
    return endpoint.closing;
  };
  const borrow = (endpoint: EndpointState): AsyncIterableIterator<Uint8Array> => {
    const lease: ReadLease = { endpoint, pending: new Set(), done: false };
    const release = (): IteratorResult<Uint8Array> => {
      lease.done = true;
      for (const request of lease.pending) {
        removeRead(request);
        request.resolve({ done: true, value: undefined });
      }
      return { done: true, value: undefined };
    };
    return {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (lease.done) return Promise.resolve({ done: true, value: undefined });
        try { checkEndpoint(endpoint); }
        catch (reason) { lease.done = true; return Promise.reject(reason); }
        return new Promise((resolve, reject) => {
          const request: ReadRequest = { lease, resolve, reject };
          reads.add(request);
          lease.pending.add(request);
          pump();
        });
      },
      async return() { return release(); },
      async throw(reason) { release(); throw reason; },
    };
  };
  const write = (endpoint: EndpointState, chunk: Uint8Array, legacy = false): Promise<void> => {
    try {
      checkFailure();
      if (!legacy) signal?.throwIfAborted();
      if (!endpoint.open) throw new FsError(legacy ? "EPIPE" : "EBADF", { syscall: "write" });
      if (!readerReferences) throw brokenPipe();
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
      if (!chunk.byteLength) return Promise.resolve();
      const owned = new Uint8Array(chunk);
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const completion = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
      const request: WriteRequest = { endpoint, chunk: owned, completion, resolve, reject };
      endpoint.writes.add(request);
      writes.add(request);
      pump();
      return completion;
    } catch (reason) { return Promise.reject(reason); }
  };
  const createState = (direction: "read" | "write"): EndpointState => {
    if (direction === "read") readerReferences++;
    else writerReferences++;
    changed();
    return { direction, writes: new Set(), open: true, closing: undefined };
  };
  const createReadEndpoint = (state: EndpointState): PipeReadEndpoint => ({
    direction: "read",
    readable: { [Symbol.asyncIterator]: () => borrow(state) },
    acquire() { checkEndpoint(state); return createReadEndpoint(createState("read")); },
    probe: () => probe(state),
    waitForChange: (previous, options) => waitForChange(state, previous, options),
    close: () => closeEndpoint(state),
  });
  const createWriteEndpoint = (state: EndpointState): PipeWriteEndpoint => {
    const writing = (chunk: Uint8Array): Promise<void> => write(state, chunk);
    return {
      direction: "write",
      writable: { write: writing, [outputFailure]: fail, ownedOutput: { consumerClosed: consumer.signal, write: writing } },
      acquire() { checkEndpoint(state); return createWriteEndpoint(createState("write")); },
      probe: () => probe(state),
      waitForChange: (previous, options) => waitForChange(state, previous, options),
      close: () => closeEndpoint(state),
    };
  };
  const readState = createState("read");
  const writeState = createState("write");
  const endpoints = { read: createReadEndpoint(readState), write: createWriteEndpoint(writeState) };
  const reader = borrow(readState);
  const iterator = (async function* (): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        if (failed) throw failure;
        const result = await reader.next();
        if (failed) throw failure;
        if (result.done) {
          finished = true;
          return;
        }
        yield result.value;
      }
    } finally {
      if (!finished) await abort();
      await reader.return?.();
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
        await reader.return?.();
      }
    },
    async throw(reason) {
      await fail(reason);
      try {
        return await iterator.throw(reason);
      } finally {
        await reader.return?.();
      }
    },
  };
  const legacyWrite = (chunk: Uint8Array): Promise<void> => write(writeState, chunk, true);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    readable,
    endpoints,
    readiness() {
      if (failed) throw failure;
      return availableBytes > 0 ? "ready" : !writerReferences && !writes.size ? "eof" : "blocked";
    },
    writable: {
      write: legacyWrite,
      [outputFailure]: fail,
      ownedOutput: { consumerClosed: consumer.signal, write: legacyWrite },
    },
    close() {
      if (failed) return Promise.reject(failure);
      closePromise ??= closeEndpoint(writeState).then(() => { checkFailure(); });
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
