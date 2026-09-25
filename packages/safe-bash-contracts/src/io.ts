import { collectBytes, readBytes } from "@poe-code/safe-fs/core";
import type { ByteSource, CollectOptions } from "@poe-code/safe-fs/core";
export { collectBytes, readBytes, toByteSource } from "@poe-code/safe-fs/core";
export type { ByteSource, CollectOptions } from "@poe-code/safe-fs/core";
import { FsError } from "./errors.js";
import { addManagedAbortWaiter, managedSignalSymbol, notifyManagedAbortWaiters, removeManagedAbortWaiter } from "./managed-abort.js";

export const outputFailure = Symbol("output failure");
const syncResolved = Symbol.for("safe-bash.syncResolved");
const ownedByteChunks = Symbol.for("safe-bash.ownedByteChunks");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });
const sharedTextEncoder = new TextEncoder();
const sharedTextDecoder = new TextDecoder();

function isSyncResolved(promise: unknown): promise is Promise<never> {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

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

const defaultAbortController = AbortController;
const defaultAbortControllerAbort = AbortController.prototype.abort;
const maximumObservationWaiters = 64;

function brokenPipe(): FsError {
  return new FsError("EPIPE", { syscall: "pipe" });
}

interface ReadRequest {
  readonly lease: PipeBorrowIterator;
  readonly resolve: (result: IteratorResult<Uint8Array>) => void;
  readonly reject: (reason: unknown) => void;
}

interface WriteRequest {
  readonly endpoint: PipeWriteEndpointImpl;
  readonly chunk: Uint8Array;
  readonly completion: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

interface ObservationWaiter {
  changed(): void;
  aborted(reason: unknown): void;
}

class PipeBorrowIterator implements AsyncIterableIterator<Uint8Array> {
  declare readonly [ownedByteChunks]: true;
  declare readonly _pipe: BytePipeImpl;
  declare readonly endpoint: PipeReadEndpointImpl;
  declare pending: Set<ReadRequest> | undefined;
  declare done: boolean;

  constructor(pipe: BytePipeImpl, endpoint: PipeReadEndpointImpl) {
    this._pipe = pipe;
    this.endpoint = endpoint;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  _release(): IteratorResult<Uint8Array> {
    this.done = true;
    if (this.pending) {
      for (const request of this.pending) {
        this._pipe._removeRead(request);
        request.resolve({ done: true, value: undefined });
      }
    }
    return { done: true, value: undefined };
  }

  tryNextSync(): IteratorResult<Uint8Array> | undefined {
    if (this.done) return { done: true, value: undefined };
    const pipe = this._pipe;
    pipe._checkEndpoint(this.endpoint);
    if (!pipe.reads || pipe.reads.size === 0) {
      const chunk = pipe._shiftChunk();
      if (chunk) {
        pipe._changed();
        if (pipe.writes && pipe.writes.size > 0) pipe._pump();
        return { done: false, value: chunk };
      }
      if (!pipe.writerReferences) {
        this.done = true;
        pipe.finished = true;
        pipe._cleanup();
        return { done: true, value: undefined };
      }
    }
    return undefined;
  }

  syncReturn(): void {
    this._release();
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    const pipe = this._pipe;
    try {
      pipe._checkEndpoint(this.endpoint);
    } catch (reason) {
      this.done = true;
      return Promise.reject(reason);
    }
    if (!pipe.reads || pipe.reads.size === 0) {
      const chunk = pipe._shiftChunk();
      if (chunk) {
        pipe._changed();
        if (pipe.writes && pipe.writes.size > 0) pipe._pump();
        return Promise.resolve({ done: false, value: chunk });
      }
      if (!pipe.writerReferences) {
        this.done = true;
        pipe.finished = true;
        pipe._cleanup();
        return Promise.resolve({ done: true, value: undefined });
      }
    }
    return new Promise((resolve, reject) => {
      const request: ReadRequest = { lease: this, resolve, reject };
      (pipe.reads ??= new Set()).add(request);
      (this.pending ??= new Set()).add(request);
      pipe._pump();
    });
  }

  async return(): Promise<IteratorResult<Uint8Array>> {
    return this._release();
  }

  async throw(reason: unknown): Promise<IteratorResult<Uint8Array>> {
    this._release();
    throw reason;
  }
}
Object.defineProperty(PipeBorrowIterator.prototype, ownedByteChunks, { value: true });
Object.assign(PipeBorrowIterator.prototype, {
  pending: undefined,
  done: false,
});

class PipeReadEndpointImpl implements PipeReadEndpoint, ByteSource {
  declare readonly direction: "read";
  declare readonly _pipe: BytePipeImpl;
  declare readonly writes: undefined;
  declare open: boolean;
  declare closing: Promise<void> | undefined;

  constructor(pipe: BytePipeImpl) {
    this._pipe = pipe;
  }

  get readable(): ByteSource {
    return this;
  }

  [Symbol.asyncIterator](): PipeBorrowIterator {
    return new PipeBorrowIterator(this._pipe, this);
  }

  acquire(): PipeReadEndpoint {
    this._pipe._checkEndpoint(this);
    this._pipe.readerReferences++;
    this._pipe._changed();
    return new PipeReadEndpointImpl(this._pipe);
  }

  probe(): PipeEndpointObservation {
    return this._pipe._probe(this);
  }

  waitForChange(previous: bigint, options: PipeEndpointWaitOptions): Promise<PipeEndpointObservation | undefined> {
    return this._pipe._waitForChange(this, previous, options);
  }

  close(): Promise<void> {
    return this._pipe._closeEndpoint(this);
  }
}
Object.assign(PipeReadEndpointImpl.prototype, {
  direction: "read",
  writes: undefined,
  open: true,
  closing: undefined,
});

class PipeWriteEndpointImpl implements PipeWriteEndpoint, ByteSink {
  declare readonly direction: "write";
  declare readonly _pipe: BytePipeImpl;
  declare writes: Set<WriteRequest> | undefined;
  declare open: boolean;
  declare closing: Promise<void> | undefined;
  declare readonly write: (chunk: Uint8Array) => Promise<void>;

  constructor(pipe: BytePipeImpl) {
    this._pipe = pipe;
    this.write = (chunk: Uint8Array) => pipe._write(this, chunk, false);
  }

  get writable(): ByteSink {
    return this;
  }

  get ownedOutput(): { readonly consumerClosed: AbortSignal; write(chunk: Uint8Array): Promise<void> } {
    return this;
  }

  get consumerClosed(): AbortSignal {
    return this._pipe._getConsumerSignal();
  }

  get [outputFailure](): (reason: unknown) => Promise<void> {
    return this._pipe._getFailHandler();
  }

  acquire(): PipeWriteEndpoint {
    this._pipe._checkEndpoint(this);
    this._pipe.writerReferences++;
    this._pipe._changed();
    return new PipeWriteEndpointImpl(this._pipe);
  }

  probe(): PipeEndpointObservation {
    return this._pipe._probe(this);
  }

  waitForChange(previous: bigint, options: PipeEndpointWaitOptions): Promise<PipeEndpointObservation | undefined> {
    return this._pipe._waitForChange(this, previous, options);
  }

  close(): Promise<void> {
    return this._pipe._closeEndpoint(this);
  }
}
Object.assign(PipeWriteEndpointImpl.prototype, {
  direction: "write",
  writes: undefined,
  open: true,
  closing: undefined,
});

class BytePipeImpl implements BytePipe {
  declare readonly highWaterMark: number;
  declare readonly signal: AbortSignal | undefined;
  declare readonly managedSignal: boolean;
  declare firstChunk: Uint8Array | undefined;
  declare restChunks: Uint8Array[] | undefined;
  declare restHead: number;
  declare reads: Set<ReadRequest> | undefined;
  declare writes: Set<WriteRequest> | undefined;
  declare observers: Set<ObservationWaiter> | undefined;
  declare availableBytes: number;
  declare readerReferences: number;
  declare writerReferences: number;
  declare revision: bigint;
  declare failed: boolean;
  declare failure: unknown;
  declare closePromise: Promise<void> | undefined;
  declare abortPromise: Promise<void> | undefined;
  declare finished: boolean;
  declare consumer: AbortController | undefined;
  declare consumerAborted: boolean;
  declare consumerReason: unknown;
  declare readonly _readEndpoint: PipeReadEndpointImpl;
  declare readonly _writeEndpoint: PipeWriteEndpointImpl;
  declare readonly endpoints: { readonly read: PipeReadEndpoint; readonly write: PipeWriteEndpoint };
  declare _failHandler: ((reason: unknown) => Promise<void>) | undefined;
  declare _onAbortHandler: (() => void) | undefined;
  declare _legacyReader: PipeBorrowIterator | undefined;
  declare _legacyIterator: AsyncGenerator<Uint8Array> | undefined;
  declare _legacyReadable: AsyncIterableIterator<Uint8Array> | undefined;
  declare _legacyWritable: ByteSink | undefined;

  constructor(options: BytePipeOptions) {
    const highWaterMark = options.highWaterMark ?? 64 * 1024;
    if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 1) {
      throw new RangeError("highWaterMark must be a positive safe integer");
    }
    this.highWaterMark = highWaterMark;
    const signal = options.signal;
    if (signal !== undefined) {
      this.signal = signal;
      this.managedSignal = Boolean((signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]);
    }
    this._readEndpoint = new PipeReadEndpointImpl(this);
    this._writeEndpoint = new PipeWriteEndpointImpl(this);
    this.endpoints = { read: this._readEndpoint, write: this._writeEndpoint };
    if (signal) {
      if (signal.aborted) this._onAbort();
      else this._attachSignal();
    }
  }

  _getFailHandler(): (reason: unknown) => Promise<void> {
    return (this._failHandler ??= (reason: unknown) => this._fail(reason));
  }

  _pushChunk(chunk: Uint8Array): void {
    if (this.firstChunk === undefined) {
      this.firstChunk = chunk;
    } else {
      (this.restChunks ??= []).push(chunk);
    }
    this.availableBytes += chunk.byteLength;
  }

  _shiftChunk(): Uint8Array | undefined {
    const chunk = this.firstChunk;
    if (!chunk) return undefined;
    const rest = this.restChunks;
    if (rest && this.restHead < rest.length) {
      this.firstChunk = rest[this.restHead++];
      if (this.restHead === rest.length) {
        rest.length = 0;
        this.restHead = 0;
      }
    } else {
      this.firstChunk = undefined;
    }
    this.availableBytes -= chunk.byteLength;
    return chunk;
  }

  _clearChunks(): void {
    this.firstChunk = undefined;
    if (this.restChunks) {
      this.restChunks.length = 0;
      this.restHead = 0;
    }
    this.availableBytes = 0;
  }

  _getConsumerSignal(): AbortSignal {
    if (!this.consumer) {
      this.consumer = new AbortController();
      (this.consumer.signal as unknown as Record<symbol, unknown>)[managedSignalSymbol] = true;
      if (this.consumerAborted) this.consumer.abort(this.consumerReason !== undefined ? this.consumerReason : brokenPipe());
    }
    return this.consumer.signal;
  }

  _abortConsumer(reason?: unknown): void {
    if (!this.consumerAborted) {
      if (
        !this.consumer &&
        (AbortController !== defaultAbortController ||
          AbortController.prototype.abort !== defaultAbortControllerAbort ||
          (this.signal !== undefined && !(this.signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]))
      ) {
        this._getConsumerSignal();
      }
      this.consumerAborted = true;
      this.consumerReason = reason;
      if (this.consumer) {
        this.consumer.abort(reason !== undefined ? reason : brokenPipe());
        notifyManagedAbortWaiters(this.consumer.signal);
      }
    }
  }

  _checkFailure(): void {
    if (this.failed) throw this.failure;
  }

  _checkEndpoint(endpoint: PipeReadEndpointImpl | PipeWriteEndpointImpl): void {
    this._checkFailure();
    this.signal?.throwIfAborted();
    if (!endpoint.open) throw new FsError("EBADF", { syscall: "pipe" });
  }

  _changed(): void {
    this.revision++;
    if (this.observers && this.observers.size > 0) {
      for (const observer of [...this.observers]) observer.changed();
    }
  }

  _removeRead(request: ReadRequest): void {
    this.reads?.delete(request);
    request.lease.pending?.delete(request);
  }

  _removeWrite(request: WriteRequest): void {
    this.writes?.delete(request);
    request.endpoint.writes?.delete(request);
  }

  _attachSignal(): void {
    const signal = this.signal;
    if (!signal) return;
    const onAbort = (this._onAbortHandler ??= () => this._onAbort());
    if (this.managedSignal) {
      addManagedAbortWaiter(signal, onAbort);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  _detachSignal(): void {
    const signal = this.signal;
    const onAbort = this._onAbortHandler;
    if (!signal || !onAbort) return;
    if (this.managedSignal) removeManagedAbortWaiter(signal, onAbort);
    else signal.removeEventListener("abort", onAbort);
  }

  _cleanup(): void {
    if (!this.observers?.size) this._detachSignal();
  }

  _pump(): void {
    if (this.failed) return;
    while (true) {
      const reading = this.reads && this.reads.size > 0 ? (this.reads.values().next().value as ReadRequest | undefined) : undefined;
      if (reading && this.firstChunk !== undefined) {
        const chunk = this._shiftChunk()!;
        this._removeRead(reading);
        reading.resolve({ done: false, value: chunk });
        this._changed();
        continue;
      }
      const writing = this.writes && this.writes.size > 0 ? (this.writes.values().next().value as WriteRequest | undefined) : undefined;
      if (writing && (reading || this.availableBytes < this.highWaterMark)) {
        this._removeWrite(writing);
        this._pushChunk(writing.chunk);
        writing.resolve();
        this._changed();
        continue;
      }
      if (!this.writerReferences && !this.writes?.size && this.firstChunk === undefined && this.reads?.size) {
        this.finished = true;
        for (const request of this.reads) {
          this._removeRead(request);
          request.lease.done = true;
          request.resolve({ done: true, value: undefined });
        }
        this._cleanup();
      }
      break;
    }
  }

  _fail(reason: unknown): Promise<void> {
    if (this.abortPromise) return this.abortPromise;
    if (this.finished) {
      if (this.observers) for (const observer of [...this.observers]) observer.aborted(reason);
      return resolvedVoid;
    }
    this.abortPromise = resolvedVoid;
    this.failed = true;
    this.failure = reason;
    this._clearChunks();
    if (this.reads) {
      for (const request of this.reads) {
        this._removeRead(request);
        request.lease.done = true;
        request.reject(reason);
      }
    }
    if (this.writes) {
      for (const request of this.writes) {
        this._removeWrite(request);
        request.reject(reason);
      }
    }
    this._abortConsumer(reason);
    this._changed();
    this._cleanup();
    return this.abortPromise;
  }

  abort(reason?: unknown): Promise<void> {
    if (this.abortPromise) return this.abortPromise;
    if (this.finished && !this.observers?.size) return resolvedVoid;
    return this._fail(reason !== undefined ? reason : brokenPipe());
  }

  _onAbort(): void {
    void this._fail(this.signal?.reason);
  }

  _probe(endpoint: PipeReadEndpointImpl | PipeWriteEndpointImpl): PipeEndpointObservation {
    this._checkEndpoint(endpoint);
    const peerClosed = endpoint.direction === "read" ? this.writerReferences === 0 : this.readerReferences === 0;
    return Object.freeze({ revision: this.revision, ready: peerClosed || (endpoint.direction === "read" && this.availableBytes > 0), peerClosed });
  }

  _waitForChange(
    endpoint: PipeReadEndpointImpl | PipeWriteEndpointImpl,
    previous: bigint,
    options: PipeEndpointWaitOptions,
  ): Promise<PipeEndpointObservation | undefined> {
    try {
      const { signal: waitingSignal, timeoutMs } = options;
      const localSignal = waitingSignal === this.signal ? undefined : waitingSignal;
      this._checkFailure();
      this.signal?.throwIfAborted();
      waitingSignal?.throwIfAborted();
      this._checkEndpoint(endpoint);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
        throw new RangeError("timeoutMs must be an integer between zero and 2147483647");
      }
      if (typeof previous !== "bigint" || previous < 0n || previous > this.revision) {
        throw new RangeError("Invalid pipe observation revision");
      }
      if (previous !== this.revision) return Promise.resolve(this._probe(endpoint));
      if (!timeoutMs) return Promise.resolve(undefined);
      if ((this.observers?.size ?? 0) >= maximumObservationWaiters) {
        throw new RangeError("Too many pending pipe endpoint observations");
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const retire = (): boolean => {
          if (settled) return false;
          settled = true;
          this.observers?.delete(observer);
          if (timer !== undefined) clearTimeout(timer);
          localSignal?.removeEventListener("abort", interrupted);
          if (this.finished || this.failed || (!this.readerReferences && !this.writerReferences)) this._cleanup();
          return true;
        };
        const settle = (timedOut = false): void => {
          if (!retire()) return;
          try {
            this._checkFailure();
            this.signal?.throwIfAborted();
            waitingSignal?.throwIfAborted();
            this._checkEndpoint(endpoint);
            resolve(timedOut ? undefined : this._probe(endpoint));
          } catch (reason) {
            reject(reason);
          }
        };
        const interrupted = (): void => settle();
        const observer: ObservationWaiter = {
          changed: () => settle(),
          aborted: (reason) => {
            if (retire()) reject(this.signal?.aborted ? this.signal.reason : reason);
          },
        };
        (this.observers ??= new Set()).add(observer);
        try {
          this._attachSignal();
          localSignal?.addEventListener("abort", interrupted, { once: true });
          if (settled) {
            localSignal?.removeEventListener("abort", interrupted);
            if (this.finished || this.failed || (!this.readerReferences && !this.writerReferences)) this._cleanup();
          }
          if (this.signal?.aborted || waitingSignal?.aborted || this.revision !== previous || !endpoint.open || this.failed) settle();
          if (!settled) timer = setTimeout(() => settle(true), timeoutMs);
        } catch (reason) {
          if (retire()) reject(reason);
        }
      });
    } catch (reason) {
      return Promise.reject(reason);
    }
  }

  _closeEndpoint(endpoint: PipeReadEndpointImpl | PipeWriteEndpointImpl): Promise<void> {
    if (endpoint.closing) return endpoint.closing;
    endpoint.open = false;
    const admittedWrites = endpoint.writes && endpoint.writes.size > 0 ? [...endpoint.writes].map(request => request.completion) : undefined;
    if (endpoint.direction === "read") {
      this.readerReferences--;
      if (this.reads) {
        for (const request of this.reads) {
          if (request.lease.endpoint === endpoint) {
            this._removeRead(request);
            request.lease.done = true;
            request.reject(this.failed ? this.failure : new FsError("EBADF", { syscall: "read" }));
          }
        }
      }
      if (!this.readerReferences) {
        this._clearChunks();
        if (this.writes && this.writes.size > 0) {
          const reason = this.failed ? this.failure : brokenPipe();
          for (const request of this.writes) {
            this._removeWrite(request);
            request.reject(reason);
          }
          this._abortConsumer(reason);
        } else {
          this._abortConsumer(this.failed ? this.failure : undefined);
        }
      }
    } else {
      this.writerReferences--;
    }
    this._changed();
    this._pump();
    if (!this.readerReferences && !this.writerReferences) {
      this.finished = true;
      this._cleanup();
    }
    if (!admittedWrites) {
      endpoint.closing = resolvedVoid;
      return resolvedVoid;
    }
    let closed!: () => void;
    endpoint.closing = new Promise(resolve => {
      closed = resolve;
    });
    void Promise.allSettled(admittedWrites).then(closed);
    return endpoint.closing;
  }

  _write(endpoint: PipeWriteEndpointImpl, chunk: Uint8Array, legacy = false): Promise<void> {
    try {
      this._checkFailure();
      if (!legacy) this.signal?.throwIfAborted();
      if (!endpoint.open) throw new FsError(legacy ? "EPIPE" : "EBADF", { syscall: "write" });
      if (!this.readerReferences) throw brokenPipe();
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
      if (!chunk.byteLength) return resolvedVoid;
      const owned = new Uint8Array(chunk);
      if (!this.writes || this.writes.size === 0) {
        const reading = this.reads && this.reads.size > 0 ? (this.reads.values().next().value as ReadRequest | undefined) : undefined;
        if (reading && this.firstChunk === undefined) {
          this._removeRead(reading);
          reading.resolve({ done: false, value: owned });
          this._changed();
          return resolvedVoid;
        }
        if (this.availableBytes < this.highWaterMark) {
          this._pushChunk(owned);
          this._changed();
          return resolvedVoid;
        }
      }
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const completion = new Promise<void>((accept, refuse) => {
        resolve = accept;
        reject = refuse;
      });
      const request: WriteRequest = { endpoint, chunk: owned, completion, resolve, reject };
      (endpoint.writes ??= new Set()).add(request);
      (this.writes ??= new Set()).add(request);
      this._pump();
      return completion;
    } catch (reason) {
      return Promise.reject(reason);
    }
  }

  _getLegacyIterator(): AsyncGenerator<Uint8Array> {
    if (!this._legacyIterator) {
      const reader = (this._legacyReader ??= new PipeBorrowIterator(this, this._readEndpoint));
      this._legacyIterator = (async function* (this: BytePipeImpl): AsyncGenerator<Uint8Array> {
        try {
          while (true) {
            if (this.failed) throw this.failure;
            const result = await reader.next();
            if (this.failed) throw this.failure;
            if (result.done) {
              this.finished = true;
              return;
            }
            yield result.value;
          }
        } finally {
          if (!this.finished) await this.abort();
          await reader.return();
        }
      }).call(this);
    }
    return this._legacyIterator;
  }

  get readable(): ByteSource {
    if (!this._legacyReadable) {
      this._legacyReadable = createLegacyReadable(this);
    }
    return this._legacyReadable;
  }

  get writable(): ByteSink {
    if (!this._legacyWritable) {
      this._legacyWritable = createLegacyWritable(this);
    }
    return this._legacyWritable;
  }

  readiness(): "ready" | "eof" | "blocked" {
    if (this.failed) throw this.failure;
    return this.availableBytes > 0 ? "ready" : !this.writerReferences && !this.writes?.size ? "eof" : "blocked";
  }

  close(): Promise<void> {
    if (this.failed) return Promise.reject(this.failure);
    this.closePromise ??= this._closeEndpoint(this._writeEndpoint).then(() => {
      this._checkFailure();
    });
    return this.closePromise;
  }
}
Object.assign(BytePipeImpl.prototype, {
  signal: undefined,
  managedSignal: false,
  firstChunk: undefined,
  restChunks: undefined,
  restHead: 0,
  reads: undefined,
  writes: undefined,
  observers: undefined,
  availableBytes: 0,
  readerReferences: 1,
  writerReferences: 1,
  revision: 2n,
  failed: false,
  failure: undefined,
  closePromise: undefined,
  abortPromise: undefined,
  finished: false,
  consumer: undefined,
  consumerAborted: false,
  consumerReason: undefined,
  _failHandler: undefined,
  _onAbortHandler: undefined,
  _legacyReader: undefined,
  _legacyIterator: undefined,
  _legacyReadable: undefined,
  _legacyWritable: undefined,
});

export function createBytePipe(options: BytePipeOptions = {}): BytePipe {
  return new BytePipeImpl(options);
}

export function writeText(sink: ByteSink, text: string): Promise<void> {
  return sink.write(sharedTextEncoder.encode(text));
}

export function writeBytes(sink: ByteSink, chunk: Uint8Array, signal?: AbortSignal): Promise<void> {
  if (!(chunk instanceof Uint8Array)) return Promise.reject(new TypeError("Byte sinks require Uint8Array chunks"));
  try {
    signal?.throwIfAborted();
    const pending = sink.write(chunk);
    if (!signal || isSyncResolved(pending)) {
      if (signal?.aborted) {
        void Promise.resolve(pending).catch(() => {});
        return Promise.reject(signal.reason);
      }
      return isSyncResolved(pending) ? resolvedVoid : Promise.resolve(pending);
    }
    if (signal.aborted) {
      void Promise.resolve(pending).catch(() => {});
      return Promise.reject(signal.reason);
    }
    return waitAbortable(pending, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function pipeBytes(source: ByteSource, sink: ByteSink, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  for await (const chunk of readBytes(source, signal)) {
    await writeBytes(sink, chunk, signal);
  }
  signal?.throwIfAborted();
}

export async function collectText(source: ByteSource, options: CollectOptions): Promise<string> {
  return sharedTextDecoder.decode(await collectBytes(source, options));
}

function abortable<Result>(operation: () => PromiseLike<Result>, signal?: AbortSignal): Promise<Result> {
  try {
    signal?.throwIfAborted();
    const pending = operation();
    const completed = !signal || isSyncResolved(pending);
    if (signal?.aborted) {
      // The host can abort during write(), before the listener is installed.
      // Observe its completion even though cancellation settles this caller.
      void Promise.resolve(pending).catch(() => {});
      return Promise.reject(signal.reason);
    }
    if (completed) return Promise.resolve(pending);
    return waitAbortable(pending, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}

function waitAbortable<Result>(pending: PromiseLike<Result>, signal: AbortSignal): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(pending).then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function createLegacyReadable(pipe: BytePipeImpl): AsyncIterableIterator<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      return pipe._getLegacyIterator().next();
    },
    async return() {
      if (!pipe.finished) await pipe.abort();
      try {
        return await pipe._getLegacyIterator().return(undefined);
      } finally {
        await pipe._legacyReader?.return();
      }
    },
    async throw(reason) {
      await pipe._fail(reason);
      try {
        return await pipe._getLegacyIterator().throw(reason);
      } finally {
        await pipe._legacyReader?.return();
      }
    },
  };
}

function createLegacyWritable(pipe: BytePipeImpl): ByteSink {
  const legacyWrite = (chunk: Uint8Array): Promise<void> => pipe._write(pipe._writeEndpoint, chunk, true);
  return {
    write: legacyWrite,
    [outputFailure]: pipe._getFailHandler(),
    ownedOutput: {
      get consumerClosed() {
        return pipe._getConsumerSignal();
      },
      write: legacyWrite,
    },
  };
}
