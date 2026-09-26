import { FsError, toByteSource } from "../contracts/index.js";
import type { ByteSource, CommandInput, FileReadHandle, FileStat, FileSystem, FileSystemCapabilities, InvocationCleanup } from "../contracts/index.js";
import { hasRegisteredYieldCheckpoint } from "../contracts/yield.js";
import { monotonicNow, yieldTurn } from "../contracts/yield.js";
import { addAbortSignalWaiter, interruptible, removeAbortSignalWaiter, type AbortSignalWaiter } from "../fs/creation-mask.js";
import type { Budget } from "./runtime.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueAllocation, ValueReservation } from "../contracts/value.js";
import type { ValueScope } from "./value-state.js";
import type { CommandContext } from "../contracts/command.js";
import { openCommandFile, type CommandFileDescriptor } from "../contracts/filesystem-descriptor.js";
import type { ShellReadProbe } from "./extensions.js";

export interface PreparedShellInput {
  readonly source: ByteSource;
  readonly options: Pick<ShellInputOptions, "provenance" | "poll" | "eof" | "descriptor"> & InputProvenance;
  close(): Promise<void>;
}

const inputBuffersSymbol = Symbol("safe-bash.inputBuffers");
const fallbackInputBuffers = new WeakMap<Budget, Set<InputBufferLease>>();

function getInputBufferLeases(budget: Budget): Set<InputBufferLease> | undefined {
  return (budget as unknown as Record<symbol, Set<InputBufferLease> | undefined>)[inputBuffersSymbol] ?? fallbackInputBuffers.get(budget);
}

function setInputBufferLeases(budget: Budget, leases: Set<InputBufferLease> | undefined): void {
  if (Object.isExtensible(budget)) {
    (budget as unknown as Record<symbol, Set<InputBufferLease> | undefined>)[inputBuffersSymbol] = leases;
  } else if (leases) {
    fallbackInputBuffers.set(budget, leases);
  } else {
    fallbackInputBuffers.delete(budget);
  }
}

const inputByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, "byteLength")!.get!;
const ownedByteChunks = Symbol.for("safe-bash.ownedByteChunks");

export function inputBufferUsage(budget: Budget): Readonly<{ bytes: number; buffers: number }> {
  let bytes = 0;
  const leases = getInputBufferLeases(budget);
  if (leases) for (const lease of leases) bytes += lease.capacity;
  return Object.freeze({ bytes, buffers: leases?.size ?? 0 });
}

class InputBufferLease {
  bytes: Uint8Array | undefined;

  constructor(private readonly budget: Budget, readonly capacity: number, allocate: () => Uint8Array) {
    budget.signal.throwIfAborted();
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > Math.max(1, budget.limits.maxInputBytes)) {
      throw new FsError("EFBIG", { syscall: "read" });
    }
    let leases = getInputBufferLeases(budget);
    if (!leases) { leases = new Set(); setInputBufferLeases(budget, leases); }
    leases.add(this);
    try {
      this.bytes = allocate();
      budget.signal.throwIfAborted();
    } catch (error) { this.release(); budget.signal.throwIfAborted(); throw error; }
  }

  release(): void {
    this.bytes = undefined;
    const leases = getInputBufferLeases(this.budget);
    leases?.delete(this);
    if (!leases?.size) setInputBufferLeases(this.budget, undefined);
  }
}

export function prepareBytesInput(value: string | Uint8Array, budget: Budget): PreparedShellInput {
  budget.signal.throwIfAborted();
  if (typeof value !== "string" && !(value instanceof Uint8Array)) throw new TypeError("Shell input must be a string or Uint8Array");
  const length = typeof value === "string" ? Buffer.byteLength(value) : inputByteLength.call(value) as number;
  if (length > budget.limits.maxInputBytes) throw new FsError("EFBIG", { syscall: "read" });
  let buffer: InputBufferLease | undefined;
  let sent = false;
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closed = true;
    buffer?.release();
    buffer = undefined;
    removeAbortSignalWaiter(budget.signal, aborted);
    return closing ??= resolvedVoid;
  };
  const aborted = (): void => { void close(); };
  try {
    if (length) {
      buffer = new InputBufferLease(budget, length, () => typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value));
    }
    addAbortSignalWaiter(budget.signal, aborted);
    const source: AsyncIterableIterator<Uint8Array> & {
      tryNextSync(): IteratorResult<Uint8Array> | undefined;
      syncReturn(): void;
      [ownedByteChunks]: true;
    } = {
      [ownedByteChunks]: true,
      [Symbol.asyncIterator]() { return this; },
      tryNextSync() {
        budget.signal.throwIfAborted();
        const bytes = buffer?.bytes;
        if (closed || sent || !bytes?.byteLength) return { done: true, value: undefined };
        sent = true;
        return { done: false, value: bytes };
      },
      syncReturn() {
        void close();
      },
      async next() {
        return this.tryNextSync()!;
      },
      async return() { await close(); return { done: true as const, value: undefined }; },
    };
    return Object.freeze({ source, close, options: Object.freeze({ provenance: "stream", poll: () => {
      budget.signal.throwIfAborted();
      if (closed) throw new Error("Prepared input is closed");
      return !sent && length ? "ready" : "eof";
    } }) });
  } catch (error) { void close(); throw error; }
}

export async function prepareFileInput(
  context: Pick<CommandContext, "fs" | "signal"> & Required<Pick<CommandContext, "registerCleanup">>
    & { readonly cleanupFailurePrioritySignal?: AbortSignal | undefined; readonly readwrite?: boolean },
  path: string,
  budget: Budget,
  inputProfile: Pick<FileSystem, "readStream" | "capabilities"> = context.fs,
  admittedStat?: FileStat,
): Promise<PreparedShellInput> {
  const { fs, signal: parent, registerCleanup: register, cleanupFailurePrioritySignal } = context;
  const registerCleanup = register.bind(context);
  const signal = AbortSignal.any([parent, budget.signal]);
  const readerController = new AbortController();
  const readSignal = AbortSignal.any([signal, readerController.signal]);
  let descriptor: CommandFileDescriptor | undefined;
  let legacy: AsyncIterator<Uint8Array> | undefined;
  let legacySource: (ByteSource & InputProvenance) | undefined;
  let stat: FileStat | undefined;
  let accepting = true;
  let ended = false;
  let buffer: InputBufferLease | undefined;
  let size = 0;
  let pendingReads = 0;
  let work: Promise<void> = Promise.resolve();
  let admitted!: () => void;
  const acquisition = new Promise<void>(resolve => { admitted = resolve; });
  let closing: Promise<void> | undefined;
  let teardownFailed = false;
  const close = (): Promise<void> => {
    accepting = false;
    if (pendingReads && !readerController.signal.aborted) readerController.abort(new FsError("EBADF", { syscall: "read", path }));
    closing ??= (async () => {
      await acquisition;
      await work;
      try {
        if (descriptor) await descriptor.close();
        else await legacy?.return?.();
      } catch (error) {
        teardownFailed = true;
        (cleanupFailurePrioritySignal ?? signal).throwIfAborted();
        throw error;
      } finally {
        descriptor = undefined;
        legacy = undefined;
        legacySource = undefined;
        buffer?.release();
        buffer = undefined;
        removeAbortSignalWaiter(signal, aborted);
      }
      signal.throwIfAborted();
    })();
    void closing.catch(() => {});
    return closing;
  };
  const aborted = (): void => { void close().catch(() => {}); };
  const check = (): void => {
    signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { syscall: "read", path });
  };
  try {
    registerCleanup(cleanupFailurePrioritySignal === undefined ? close : async () => {
      try { await close(); }
      catch (error) {
        if (teardownFailed) cleanupFailurePrioritySignal.throwIfAborted();
        throw error;
      }
    });
    addAbortSignalWaiter(signal, aborted);
    check();
    const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
    check();
    let provenance: NonNullable<ShellInputOptions["provenance"]> = "unknown";
    if (capabilities.open === true || capabilities.open !== false && typeof fs.open === "function") {
      descriptor = await openCommandFile({ fs, signal, registerCleanup, cleanupFailurePrioritySignal }, path, { access: context.readwrite ? "readwrite" : "read", ...(context.readwrite ? { creation: "ifMissing" as const } : {}), signal });
    } else {
      if (context.readwrite) throw new FsError("ENOTSUP", { syscall: "open", path });
      stat = admittedStat ?? await fs.stat(path, { signal });
      check();
      legacySource = await fileInput(fs, path, budget.limits.maxInputBytes, readSignal, inputProfile, { stat, registerCleanup });
      legacy = legacySource[Symbol.asyncIterator]();
      stat = legacySource.stat ?? stat;
    }
    check();
    if (descriptor) {
      stat = await descriptor.stat({ signal });
      check();
    }
    if (stat) {
      if (stat.type === "directory") throw new FsError("EISDIR", { syscall: "read", path });
      if (descriptor || legacySource?.stat) provenance = stat.type === "file" ? "regular" : stat.type === "character" ? "stream" : "unknown";
    }
    const source = {
      [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> { return this; },
      next(maximum = 64 * 1024): Promise<IteratorResult<Uint8Array>> {
        try {
          signal.throwIfAborted();
          if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new RangeError("Input chunk size must be a positive safe integer");
          if (ended) return Promise.resolve({ done: true, value: undefined });
          check();
        }
        catch (error) { return Promise.reject(error); }
        pendingReads++;
        const operation = work.then(async (): Promise<IteratorResult<Uint8Array>> => {
          signal.throwIfAborted();
          if (ended) return { done: true, value: undefined };
          check();
          if (legacy) {
            const result = await (legacySource?.readChunk ? legacySource.readChunk(maximum) : legacy.next());
            check();
            ended = result.done === true && provenance !== "regular";
            return result;
          }
          if (!buffer) {
            const capacity = Math.min(64 * 1024, budget.limits.maxInputBytes) || 1;
            buffer = new InputBufferLease(budget, capacity, () => new Uint8Array(capacity));
          }
          const bytes = buffer.bytes!;
          const remaining = budget.limits.maxInputBytes - size;
          const chunk = bytes.subarray(0, Math.min(maximum, remaining >= bytes.length ? bytes.length : remaining + 1));
          const length = await descriptor!.read(chunk, null, { signal: readSignal });
          check();
          if (!Number.isSafeInteger(length) || length < 0 || length > chunk.length) throw new FsError("EIO", { syscall: "read", path });
          if (length > budget.limits.maxInputBytes - size) throw new FsError("EFBIG", { syscall: "read", path });
          size += length;
          const done = length === 0;
          ended = done && provenance !== "regular";
          return done ? { done: true, value: undefined } : { done: false, value: chunk.subarray(0, length) };
        });
        work = operation.then(() => { pendingReads--; }, () => { pendingReads--; });
        return operation.then(async result => {
          if (result.done && provenance !== "regular") {
            if (legacy) await close();
            else { buffer?.release(); buffer = undefined; }
          }
          signal.throwIfAborted();
          return result;
        }, async error => {
          try { await close(); } catch {}
          signal.throwIfAborted();
          throw error;
        });
      },
      async return() { await close(); return { done: true as const, value: undefined }; },
    };
    admitted();
    const seek = legacySource?.seek;
    return Object.freeze({ source, close, options: Object.freeze({
      provenance, eof: provenance === "regular" ? "retryable" : "terminal",
      ...(descriptor ? { descriptor } : {}), ...(stat ? { stat } : {}),
      readChunk: source.next.bind(source),
      ...(seek ? { async seek(position: number, callerSignal: AbortSignal) {
        callerSignal.throwIfAborted();
        check();
        await work;
        check();
        callerSignal.throwIfAborted();
        await seek.call(legacySource, position, callerSignal);
        check();
        ended = false;
      } } : {}),
    }) });
  } catch (error) {
    admitted();
    try { await close(); } catch {}
    signal.throwIfAborted();
    throw error;
  }
}

type InputProvenance = Pick<CommandInput, "stat" | "seek"> & {
  readonly readChunk?: (maxBytes?: number) => Promise<IteratorResult<Uint8Array>>;
};

export async function fileInput(fs: FileSystem, path: string, maxBytes: number, signal: AbortSignal, inputProfile: Pick<FileSystem, "readStream" | "capabilities"> = fs, ownership?: { stat: FileStat; registerCleanup: (cleanup: InvocationCleanup) => void }): Promise<ByteSource & InputProvenance> {
  let admittedCapabilities: FileSystemCapabilities | undefined;
  if (ownership?.stat.type === "file") {
    let handle: FileReadHandle | undefined;
    let closing: Promise<void> | undefined;
    let closed = false;
    const pending = new Set<Promise<unknown>>();
    const close = (): Promise<void> => {
      closed = true;
      closing ??= (async () => {
        await Promise.allSettled([...pending]);
        await handle?.close();
      })();
      return closing;
    };
    const work = async <Value>(operation: () => Promise<Value>): Promise<Value> => {
      signal.throwIfAborted();
      if (closed) throw new FsError("EBADF", { path });
      const task = Promise.resolve().then(operation);
      pending.add(task);
      void task.finally(() => { pending.delete(task); }).catch(() => undefined);
      return interruptible(task, signal);
    };
    try {
      const capabilities = admittedCapabilities = await work(() => Promise.resolve(fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities));
      if (capabilities.retainedRead === true && fs.openReadFile) {
        ownership.registerCleanup(close);
        try {
          await work(async () => { handle = await fs.openReadFile!(path, { signal }); });
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
        }
        if (handle) {
          const stat = await work(() => handle!.stat({ signal }));
          signal.throwIfAborted();
          let position = 0;
          let size = 0;
          const readChunk = async (maximum = 64 * 1024): Promise<IteratorResult<Uint8Array>> => {
            const count = Math.min(maximum, 64 * 1024, maxBytes - size + 1, Number.MAX_SAFE_INTEGER - position);
            if (count === 0) return { done: true, value: undefined };
            const bytes = await work(async () => {
              const result = await handle!.read(position, count, { signal });
              if (!(result instanceof Uint8Array) || result.byteLength > count) throw new FsError("EIO", { syscall: "read", path });
              if (result.byteLength > maxBytes - size) throw new FsError("EFBIG", { syscall: "read", path });
              return new Uint8Array(result);
            });
            signal.throwIfAborted();
            size += bytes.byteLength;
            position += bytes.byteLength;
            return bytes.byteLength ? { done: false, value: bytes } : { done: true, value: undefined };
          };
          return {
            stat,
            readChunk,
            ...(stat.type === "file" ? { async seek(absolutePosition: number, callerSignal: AbortSignal) {
              callerSignal.throwIfAborted();
              signal.throwIfAborted();
              if (closed) throw new FsError("EBADF", { path });
              position = absolutePosition;
            } } : {}),
            [Symbol.asyncIterator]: () => ({
              next: readChunk,
              async return() { await close(); return { done: true, value: undefined }; },
            }),
          };
        }
      }
    } catch (error) {
      await close();
      throw error;
    }
  }
  signal.throwIfAborted();
  async function bufferedInput(): Promise<ByteSource> {
    signal.throwIfAborted();
    const bytes = await interruptible(fs.readFile(path, { signal, ...(maxBytes === Infinity ? {} : { maxBytes }) }), signal);
    signal.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw new FsError("EFBIG", { syscall: "readFile", path });
    return toByteSource(bytes);
  }
  const readStream = fs.readStream;
  const capabilities = admittedCapabilities ?? await interruptible(Promise.resolve(fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities), signal);
  if (!readStream || capabilities.streamingRead === false) {
    if (!inputProfile.readStream || inputProfile.capabilities.streamingRead === false) return bufferedInput();
    return { async *[Symbol.asyncIterator]() { yield* await bufferedInput(); } };
  }
  let iterator: AsyncIterator<Uint8Array>;
  try { iterator = readStream.call(fs, path, { signal })[Symbol.asyncIterator](); }
  catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
    return bufferedInput();
  }
  let size = 0;
  let buffered = false;
  let closed = false;
  let returned: Promise<IteratorResult<Uint8Array>> | undefined;
  function closeIterator(): Promise<IteratorResult<Uint8Array>> {
    returned ??= Promise.resolve().then(() => iterator.return?.() ?? { done: true, value: undefined });
    return returned;
  }
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        signal.throwIfAborted();
        if (closed) return { done: true, value: undefined };
        let result: IteratorResult<Uint8Array>;
        try { result = await interruptible(Promise.resolve(iterator.next()), signal); }
        catch (error) {
          signal.throwIfAborted();
          if (buffered || size > 0 || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
          await interruptible(closeIterator(), signal);
          signal.throwIfAborted();
          if (closed) return { done: true, value: undefined };
          const source = await bufferedInput();
          if (closed) return { done: true, value: undefined };
          iterator = source[Symbol.asyncIterator]();
          buffered = true;
          returned = undefined;
          result = await iterator.next();
        }
        signal.throwIfAborted();
        if (!result.done) {
          if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
          if (result.value.byteLength > maxBytes - size) throw new FsError("EFBIG", { syscall: "readFile", path });
          size += result.value.byteLength;
        }
        return result;
      },
      return() {
        closed = true;
        return closeIterator();
      },
    }),
  };
}

export type InputReadiness = "ready" | "eof" | "blocked" | "unknown";

export interface InputClock {
  now(): number;
  schedule(delayMs: number, expire: () => void): () => void;
}

export interface ShellInputOptions {
  readonly descriptor?: CommandFileDescriptor;
  readonly provenance?: "regular" | "stream" | "unknown";
  readonly eof?: "terminal" | "retryable";
  readonly poll?: () => InputReadiness;
  readonly clock?: InputClock;
  readonly initialChunk?: Uint8Array;
  readonly initialChunkOwned?: boolean;
  readonly initialEof?: boolean;
  readonly onInitialConsumed?: () => void;
  readonly signalIncludesBudget?: boolean;
}
const shellInputViewClosedError = new Error("Shell input view closed");
const resolvedVoid = Promise.resolve();
const doneResult: IteratorResult<Uint8Array> = Object.freeze({ done: true, value: undefined });
const resolvedDoneResult: Promise<IteratorResult<Uint8Array>> = Promise.resolve(doneResult);

const inputClock: InputClock = {
  now: monotonicNow,
  schedule(delayMs, expire) {
    const timer = setTimeout(expire, Math.min(delayMs, 2_147_483_647));
    return () => clearTimeout(timer);
  },
};
const defaultFrozenInputClock: InputClock = Object.freeze({
  now: inputClock.now.bind(inputClock),
  schedule: inputClock.schedule.bind(inputClock),
});

class InputDeadline {
  private readonly _controller = new AbortController();
  private readonly _expiresAt: number;
  private _cancel: (() => void) | undefined;
  private _closed = false;
  readonly signal: AbortSignal;

  constructor(readonly clock: InputClock, timeoutMs: number, readonly parent: AbortSignal) {
    const now = clock.now();
    this._expiresAt = now + timeoutMs;
    if (!Number.isFinite(now) || !Number.isFinite(this._expiresAt)) throw new RangeError("Invalid input clock deadline");
    this.signal = AbortSignal.any([parent, this._controller.signal]);
    parent.throwIfAborted();
    parent.addEventListener("abort", this.close, { once: true });
    try { this._schedule(); } catch (error) { this.close(); throw error; }
  }

  expired(): boolean {
    this.parent.throwIfAborted();
    if (!this._closed && this.clock.now() >= this._expiresAt) {
      this._controller.abort();
      this.close();
    }
    return this._controller.signal.aborted;
  }

  private _schedule(): void {
    const cancel = this.clock.schedule(Math.max(0, this._expiresAt - this.clock.now()), () => {
      this._cancel = undefined;
      if (this._closed || this.parent.aborted) return;
      if (!this.expired()) this._schedule();
    });
    if (this._closed) cancel();
    else this._cancel = cancel;
  }

  readonly close = (): void => {
    this._closed = true;
    const cancel = this._cancel;
    this._cancel = undefined;
    this.parent.removeEventListener("abort", this.close);
    try { cancel?.(); }
    catch (error) { if (!this.parent.aborted) throw error; }
  };
}

class ViewReadWaiter {
  declare readonly cursor: InputCursor;
  declare readonly signal: AbortSignal;
  declare readonly view: ShellInput;
  declare readonly resolve: (value: IteratorResult<Uint8Array>) => void;
  declare readonly reject: (reason: unknown) => void;
  declare settled: boolean;

  constructor(
    cursor: InputCursor,
    signal: AbortSignal,
    view: ShellInput,
    resolve: (value: IteratorResult<Uint8Array>) => void,
    reject: (reason: unknown) => void,
  ) {
    this.cursor = cursor;
    this.signal = signal;
    this.view = view;
    this.resolve = resolve;
    this.reject = reject;
    this.settled = false;
  }

  onAbort(reason: unknown): void {
    if (this.settled) return;
    this.settled = true;
    removeAbortSignalWaiter(this.signal, this);
    this.view._removeCloseWaiter(this);
    this.cursor._finishConsumer();
    this.reject(reason);
  }

  onFulfilled(result: IteratorResult<Uint8Array>): void {
    if (this.settled) return;
    this.settled = true;
    removeAbortSignalWaiter(this.signal, this);
    this.view._removeCloseWaiter(this);
    const cursor = this.cursor;
    if (this.signal.aborted) { cursor._finishConsumer(); this.reject(this.signal.reason); return; }
    if (this.view._isViewClosed()) { cursor._finishConsumer(); this.reject(shellInputViewClosedError); return; }
    cursor._clearActiveRead(result.done);
    if (result.done) {
      cursor._finishConsumer();
      this.resolve(doneResult);
      return;
    }
    cursor.position += result.value.byteLength;
    const value = cursor.ownsChunks ? result.value : new Uint8Array(result.value);
    cursor._finishConsumer();
    this.resolve({ done: false, value });
  }

  onRejected(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    removeAbortSignalWaiter(this.signal, this);
    this.view._removeCloseWaiter(this);
    if (!this.signal.aborted) this.cursor._markReadFailed();
    this.cursor._finishConsumer();
    this.reject(error);
  }
}

class InputCursor {
  declare private _identity: object | undefined;
  declare private readonly _iterator: AsyncIterator<Uint8Array>;
  declare readonly ownsChunks: boolean;
  declare private readonly _provenance: "regular" | "stream" | "unknown";
  declare private readonly _eof: "terminal" | "retryable";
  declare private readonly _poll: (() => InputReadiness) | undefined;
  declare private readonly _pollReceiver: unknown;
  declare private readonly _clock: InputClock;
  declare private readonly _readChunk: InputProvenance["readChunk"];
  declare private readonly _budget: Budget;
  declare readonly stat?: FileStat;
  declare readonly seek?: CommandInput["seek"];

  get identity(): object {
    return this._identity ??= Object.freeze({});
  }
  declare position: number;
  declare remainder: Uint8Array | undefined;
  declare private _unread: Uint8Array[] | undefined;
  declare private _read: Promise<IteratorResult<Uint8Array>> | undefined;
  declare private _readResult: IteratorResult<Uint8Array> | undefined;
  declare private _readError: { reason: unknown } | undefined;
  declare private _readSettled: boolean;
  declare private _readFailed: boolean;
  declare private _turn: Promise<void>;
  declare private _turnRelease: (() => void) | undefined;
  declare private _returned: Promise<void> | undefined;
  declare private _initialChunk: Uint8Array | undefined;
  declare private _onInitialConsumed: (() => void) | undefined;
  declare private _ended: boolean;
  declare private _closed: boolean;
  declare private _consumers: number;
  declare private _produced: number;
  declare private _boundedReads: boolean;

  constructor(source: ByteSource, options: ShellInputOptions & InputProvenance, budget: Budget) {
    const { provenance = options.stat?.type === "file" ? "regular" : options.stat?.type === "character" ? "stream" : "unknown", eof = "terminal", poll, clock = inputClock } = options;
    if (provenance !== "unknown" && provenance !== "regular" && provenance !== "stream") throw new TypeError("Invalid input provenance");
    if (eof !== "terminal" && eof !== "retryable" || eof === "retryable" && provenance !== "regular") throw new TypeError("Retryable input EOF requires regular provenance");
    if (poll !== undefined && typeof poll !== "function") throw new TypeError("Invalid input polling capability");
    const { now, schedule } = clock;
    if (typeof now !== "function" || typeof schedule !== "function") throw new TypeError("Invalid input clock");
    this._identity = undefined;
    this._provenance = provenance;
    this._eof = eof;
    this._poll = poll;
    this._pollReceiver = options;
    this._clock = clock === inputClock ? defaultFrozenInputClock : Object.freeze({ now: now.bind(clock), schedule: schedule.bind(clock) });
    this._iterator = source[Symbol.asyncIterator]();
    this.ownsChunks = options.initialChunkOwned === true
      || Boolean((this._iterator as { [ownedByteChunks]?: boolean })[ownedByteChunks]);
    this._readChunk = options.readChunk?.bind(options);
    this._budget = budget;
    this.position = 0;
    this.remainder = undefined;
    this._unread = undefined;
    this._read = undefined;
    this._readResult = undefined;
    this._readError = undefined;
    this._readSettled = false;
    this._readFailed = false;
    this._turn = resolvedVoid;
    this._turnRelease = undefined;
    this._returned = undefined;
    this._initialChunk = undefined;
    this._onInitialConsumed = undefined;
    this._ended = false;
    this._closed = false;
    this._consumers = 0;
    this._produced = 0;
    this._boundedReads = false;
    if (options.initialChunk) {
      this._initialChunk = options.initialChunk;
      this._onInitialConsumed = options.onInitialConsumed;
    } else if (options.initialEof) {
      this._ended = true;
    }
    if (options.stat) this.stat = options.stat;
    if (options.seek) this.seek = async (position, signal) => {
      if (this._read) await interruptible(this._read, signal);
      signal.throwIfAborted();
      await options.seek!(position, signal);
      this.remainder = undefined;
      if (this._unread) this._unread.length = 0;
      this._read = undefined;
      this._readResult = undefined;
      this._readError = undefined;
      this._readSettled = false;
      this._ended = false;
      this.position = position;
    };
  }

  restore(chunks: readonly Uint8Array[]): void {
    if (this.remainder || chunks.length) this._unread ??= [];
    if (this.remainder) this._unread!.push(this.remainder);
    this.remainder = undefined;
    for (let index = chunks.length - 1; index >= 0; index--) this._unread!.push(chunks[index]!);
  }

  admitBoundedRead(): void {
    this._boundedReads = true;
    if (this._produced > this._budget.limits.maxInputBytes) this._budget.fail("maxInputBytes");
  }

  get bufferedBytes(): number {
    if (this._consumers) return 0;
    return (this.remainder?.length ?? 0) + (this._initialChunk?.length ?? 0) + (this._unread ? this._unread.reduce((length, chunk) => length + chunk.length, 0) : 0)
      + (this._readResult && !this._readResult.done ? this._readResult.value.length : 0);
  }

  readiness(): InputReadiness {
    if (this._consumers) return "blocked";
    if (this.remainder?.length || this._initialChunk?.length || (this._unread?.some(chunk => chunk.length) ?? false)) return "ready";
    if (this._readError) throw this._readError.reason;
    if (this._ended || this._readResult?.done) return "eof";
    if (this._readResult && this._readResult.value.length) return "ready";
    if (this._closed) throw new Error("Shell input cursor is closed");
    if (this._provenance === "regular") return "ready";
    const readiness = this._poll ? this._poll.call(this._pollReceiver) : "unknown";
    if (!["ready", "eof", "blocked", "unknown"].includes(readiness)) throw new TypeError("Invalid input readiness");
    if (readiness === "eof" && this._read && !this._readSettled) return "unknown";
    return readiness;
  }

  probeRead(): ShellReadProbe {
    const readiness = this.readiness();
    return { readiness: readiness === "eof" ? "ready" : readiness,
      timeout: this._provenance === "regular" ? "ignore" : this._provenance === "stream" ? "honor" : "unknown" };
  }

  deadline(timeoutMs: number | undefined, signal: AbortSignal, scope: ValueScope): InputDeadline | undefined {
    if (timeoutMs === undefined) return undefined;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Read timeout must be positive and finite; use readiness for zero timeout");
    if (this._provenance === "unknown") throw new TypeError("Read timeout requires explicit input provenance");
    if (this._provenance === "regular") return undefined;
    scope.reserve(192, 3);
    return new InputDeadline(this._clock, timeoutMs, signal);
  }

  _finishConsumer(): void {
    this._consumers--;
    if (this._consumers === 0) this._turn = resolvedVoid;
    const notify = this._turnRelease;
    if (notify) {
      this._turnRelease = undefined;
      notify();
    }
  }

  _clearActiveRead(ended?: boolean): void {
    this._read = undefined;
    this._readResult = undefined;
    if (ended) this._ended = true;
  }

  _markReadFailed(): void {
    this._read = undefined;
    this._readFailed = true;
    this._closed = true;
  }

  async consume<Value>(signal: AbortSignal, operation: () => Promise<Value>, interrupted?: (error: unknown) => Promise<Value>): Promise<Value> {
    if (signal.aborted && interrupted) return interrupted(signal.reason);
    signal.throwIfAborted();
    if (this._consumers === 0 && this._turn === resolvedVoid) {
      this._consumers = 1;
      try {
        if (this._eof === "retryable") this._ended = false;
        return await operation();
      } finally {
        this._finishConsumer();
      }
    }
    if (this._turn === resolvedVoid) {
      this._turn = new Promise<void>(resolve => { this._turnRelease = resolve; });
    }
    const previous = this._turn;
    let release!: () => void;
    const completed = new Promise<void>((resolve) => { release = resolve; });
    this._turn = previous.then(() => completed);
    this._consumers++;
    try {
      try { await interruptible(previous, signal); signal.throwIfAborted(); }
      catch (error) { if (signal.aborted && interrupted) return await interrupted(error); throw error; }
      if (this._eof === "retryable") this._ended = false;
      return await operation();
    } finally {
      this._consumers--;
      if (this._consumers === 0) this._turn = resolvedVoid;
      release();
    }
  }

  tryTakeReadySync(): IteratorResult<Uint8Array> | undefined {
    if (this._consumers) return undefined;
    if (this.remainder) {
      const value = this.remainder;
      this.remainder = undefined;
      return { value, done: false };
    }
    const unread = this._unread?.pop();
    if (unread) return { value: unread, done: false };
    if (this._initialChunk) {
      const chunk = this._initialChunk;
      this._initialChunk = undefined;
      this._onInitialConsumed?.();
      if (this._boundedReads && chunk.byteLength > this._budget.limits.maxInputBytes - this._produced) this._budget.fail("maxInputBytes");
      this._produced += chunk.byteLength;
      this._ended = true;
      return { value: chunk, done: false };
    }
    if (this._ended && this._eof === "retryable" && !this._closed) return undefined;
    if (this._ended || this._closed) return { value: undefined, done: true };
    if (!this._read && !this._readChunk) {
      const syncIter = this._iterator as { tryNextSync?: () => IteratorResult<Uint8Array> | undefined };
      if (typeof syncIter.tryNextSync === "function") {
        const res = syncIter.tryNextSync();
        if (res !== undefined) {
          if (res.done) {
            this._ended = true;
            return { value: undefined, done: true };
          }
          if (this._boundedReads && res.value.byteLength > this._budget.limits.maxInputBytes - this._produced) this._budget.fail("maxInputBytes");
          this._produced += res.value.byteLength;
          return { value: res.value, done: false };
        }
      }
    }
    return undefined;
  }

  async take(signal: AbortSignal, maxBytes?: number): Promise<IteratorResult<Uint8Array>> {
    signal.throwIfAborted();
    if (this.remainder) {
      const value = this.remainder;
      this.remainder = undefined;
      return { value, done: false };
    }
    const unread = this._unread?.pop();
    if (unread) return { value: unread, done: false };
    if (this._initialChunk) {
      const chunk = this._initialChunk;
      this._initialChunk = undefined;
      this._onInitialConsumed?.();
      if (this._boundedReads && chunk.byteLength > this._budget.limits.maxInputBytes - this._produced) this._budget.fail("maxInputBytes");
      this._produced += chunk.byteLength;
      this._ended = true;
      return { value: this._boundedReads ? new Uint8Array(chunk) : chunk, done: false };
    }
    if (this._ended || this._closed) return { value: undefined, done: true };
    if (!this._read) {
      this._readSettled = false;
      this._readResult = undefined;
      let rawNext: Promise<IteratorResult<Uint8Array>>;
      try {
        rawNext = Promise.resolve(this._closed ? doneResult : this._readChunk ? this._readChunk(maxBytes) : this._iterator.next());
      } catch (err) {
        rawNext = Promise.reject(err);
      }
      this._read = rawNext.then(
        (result): IteratorResult<Uint8Array> => {
          if (result.done) {
            this._readSettled = true;
            this._readResult = doneResult;
            return doneResult;
          }
          if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
          if (this._boundedReads && result.value.byteLength > this._budget.limits.maxInputBytes - this._produced) this._budget.fail("maxInputBytes");
          this._produced += result.value.byteLength;
          const out: IteratorResult<Uint8Array> = { value: this._boundedReads ? new Uint8Array(result.value) : result.value, done: false };
          this._readSettled = true;
          this._readResult = out;
          return out;
        },
        (reason): never => {
          this._readSettled = true;
          this._readError = { reason };
          throw reason;
        },
      );
    }
    try {
      const result = await interruptible(this._read, signal);
      signal.throwIfAborted();
      this._read = undefined;
      this._readResult = undefined;
      if (result.done) this._ended = true;
      return result;
    } catch (error) {
      if (!signal.aborted) { this._read = undefined; this._readFailed = true; this._closed = true; }
      throw error;
    }
  }

  takeNextForView(signal: AbortSignal, view: ShellInput): Promise<IteratorResult<Uint8Array>> {
    if (this._consumers !== 0 || this._turn !== resolvedVoid) {
      return this.consume(signal, async () => {
        if (view._isViewClosed()) throw shellInputViewClosedError;
        const result = await this.take(signal);
        if (view._isViewClosed()) throw shellInputViewClosedError;
        if (result.done) return result;
        this.position += result.value.byteLength;
        return { done: false, value: this.ownsChunks ? result.value : new Uint8Array(result.value) };
      });
    }
    this._consumers = 1;
    if (this._eof === "retryable") this._ended = false;
    if (!this._read) {
      this._readSettled = false;
      this._readResult = undefined;
      let rawNext: Promise<IteratorResult<Uint8Array>>;
      try {
        rawNext = Promise.resolve(this._closed ? doneResult : this._readChunk ? this._readChunk(undefined) : this._iterator.next());
      } catch (err) {
        rawNext = Promise.reject(err);
      }
      this._read = rawNext.then(
        (result): IteratorResult<Uint8Array> => {
          if (result.done) {
            this._readSettled = true;
            this._readResult = doneResult;
            return doneResult;
          }
          if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
          if (this._boundedReads && result.value.byteLength > this._budget.limits.maxInputBytes - this._produced) this._budget.fail("maxInputBytes");
          this._produced += result.value.byteLength;
          const out: IteratorResult<Uint8Array> = { value: this._boundedReads ? new Uint8Array(result.value) : result.value, done: false };
          this._readSettled = true;
          this._readResult = out;
          return out;
        },
        (reason): never => {
          this._readSettled = true;
          this._readError = { reason };
          throw reason;
        },
      );
    }
    const readPromise = this._read;
    return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
      const waiter = new ViewReadWaiter(this, signal, view, resolve, reject);
      addAbortSignalWaiter(signal, waiter);
      view._addCloseWaiter(waiter);
      readPromise.then(
        result => waiter.onFulfilled(result),
        error => waiter.onRejected(error),
      );
    });
  }

  canCloseSync(): boolean {
    return (this._ended && this._eof === "terminal" && !this.seek)
      || !this._iterator.return
      || typeof (this._iterator as { syncReturn?: () => void }).syncReturn === "function";
  }

  closeSync(signal: AbortSignal): void {
    if (this._ended && this._eof === "terminal" && !this.seek) { signal.throwIfAborted(); return; }
    this._closed = true;
    this.remainder = undefined;
    this._initialChunk = undefined;
    if (this._unread) this._unread.length = 0;
    (this._iterator as { syncReturn?: () => void }).syncReturn?.();
    signal.throwIfAborted();
  }

  async close(signal: AbortSignal): Promise<void> {
    if (this._ended && this._eof === "terminal" && !this.seek) { signal.throwIfAborted(); return; }
    this._closed = true;
    this.remainder = undefined;
    this._initialChunk = undefined;
    if (this._unread) this._unread.length = 0;
    if (!this._iterator.return) {
      signal.throwIfAborted();
      return;
    }
    this._returned ??= Promise.resolve().then(() => this._iterator.return?.()).then(() => undefined);
    void this._returned.catch(() => undefined);
    try { await interruptible(this._returned, signal); }
    catch (error) { if (!this._readFailed) throw error; }
    signal.throwIfAborted();
  }
}

export interface ReadLineOptions {
  readonly count?: number;
  readonly delimiter?: number;
  readonly byteCount?: boolean;
  readonly exact?: boolean;
  readonly timeoutMs?: number;
}

export interface ReadField {
  readonly start: number;
  readonly end: number;
  readonly value: ShellValue;
}

export interface ReadLine {
  readonly value: string;
  readonly shellValue: ShellValue;
  readonly escaped: ReadonlySet<number>;
  readonly escapedByteOffsets: readonly number[];
  readonly terminated: boolean;
  readonly reason: "delimiter" | "count" | "eof" | "timeout";
  fields(ifs: ShellValue, maximum?: number): Promise<readonly ReadField[]>;
  release(): Promise<void>;
}

export interface RawRecordOptions {
  readonly delimiter?: number;
}

export interface RawRecord {
  readonly shellValue: ShellValue;
  readonly reason: "delimiter" | "eof";
  release(): Promise<void>;
}

class ReadBuffer {
  private _buffer: Uint8Array = new Uint8Array();
  private _reservation: ValueReservation | undefined;
  length = 0;

  constructor(readonly scope: ValueScope, readonly maximum: number) {}

  append(byte: number): void {
    if (this.length === this._buffer.length) {
      const capacity = Math.min(this.maximum, Math.max(64, this._buffer.length * 2));
      const reservation = this.scope.reserve(capacity + 64, 1);
      try {
        const buffer = new Uint8Array(capacity);
        buffer.set(this._buffer);
        reservation.commit(buffer);
        this._reservation?.release();
        this._reservation = reservation;
        this._buffer = buffer;
      } catch (error) { reservation.release(); throw error; }
    }
    this._buffer[this.length++] = byte;
  }

  bytes(): Uint8Array { return this._buffer.subarray(0, this.length); }
}

function utf8Length(first: number): number {
  return first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
}

function utf8Continuation(first: number, position: number, byte: number): boolean {
  if (byte < 0x80 || byte > 0xbf) return false;
  return position !== 1 || (first !== 0xe0 || byte >= 0xa0) && (first !== 0xed || byte < 0xa0)
    && (first !== 0xf0 || byte >= 0x90) && (first !== 0xf4 || byte < 0x90);
}

function displayWidth(bytes: Uint8Array, offset: number): number {
  const first = bytes[offset]!;
  const width = utf8Length(first);
  let consumed = 1;
  while (consumed < width && offset + consumed < bytes.length && utf8Continuation(first, consumed, bytes[offset + consumed]!)) consumed++;
  return consumed;
}

export class ShellInput implements ByteSource, CommandInput {
  declare readonly budget: Budget;
  declare readonly descriptor: CommandFileDescriptor | undefined;
  declare private _lazyCursor: InputCursor | undefined;
  declare private readonly _source: ByteSource;
  declare private readonly _options: (ShellInputOptions & InputProvenance) | undefined;
  declare private readonly _owned: boolean;
  declare private _lifetime: AbortController | undefined;
  declare private _signal: AbortSignal | undefined;
  declare private _viewClosed: boolean;
  declare private readonly _signalIncludesBudget: boolean;
  declare private _closeWaiter: AbortSignalWaiter | undefined;
  declare private _closeWaiters: Set<AbortSignalWaiter> | undefined;
  declare private readonly _cleanupSignal: AbortSignal;
  declare private _reads: Set<() => Promise<void>> | undefined;
  declare readonly stat?: FileStat;
  declare readonly seek?: NonNullable<CommandInput["seek"]>;
  declare private _closing: Promise<void> | undefined;

  constructor(source: ByteSource, budget: Budget, signal = budget.signal, options?: ShellInputOptions & InputProvenance, signalIncludesBudget?: boolean) {
    this.budget = budget;
    this._owned = !(source instanceof ShellInput);
    if (!this._owned && options !== undefined) throw new TypeError("Borrowed input cannot replace cursor capabilities");
    this._source = source;
    this._options = options;
    this.descriptor = source instanceof ShellInput ? source.descriptor : options?.descriptor;
    this._lazyCursor = undefined;
    this._lifetime = undefined;
    this._signal = undefined;
    this._viewClosed = false;
    this._closeWaiter = undefined;
    this._closeWaiters = undefined;
    this._cleanupSignal = signal;
    this._reads = undefined;
    this._closing = undefined;
    this._signalIncludesBudget = signalIncludesBudget ?? options?.signalIncludesBudget ?? (signal === budget.signal || hasRegisteredYieldCheckpoint(signal));
    const canDeferCursor = source instanceof ShellInput
      ? (source._lazyCursor === undefined)
      : (options !== undefined && options.initialEof === true && options.stat === undefined && options.seek === undefined && options.poll === undefined && options.clock === undefined && options.initialChunk === undefined && (options.provenance === undefined || options.provenance === "unknown" || options.provenance === "regular" || options.provenance === "stream") && (options.eof === undefined || options.eof === "terminal"));
    if (!canDeferCursor) {
      const cursor = source instanceof ShellInput ? source._cursor : new InputCursor(source, options ?? {}, budget);
      this._lazyCursor = cursor;
      if (cursor.stat) this.stat = cursor.stat;
      if (cursor.seek) this.seek = (position, callerSignal) => {
        const signal = AbortSignal.any([this.signal, callerSignal]);
        return cursor.consume(signal, async () => {
          if (!Number.isSafeInteger(position) || position < 0) throw new RangeError("Input position must be a nonnegative safe integer");
          await cursor.seek!(position, signal);
        });
      };
    }
  }

  private get _cursor(): InputCursor {
    let c = this._lazyCursor;
    if (!c) {
      c = this._source instanceof ShellInput ? this._source._cursor : new InputCursor(this._source, this._options ?? {}, this.budget);
      this._lazyCursor = c;
    }
    return c;
  }

  get signal(): AbortSignal {
    if (!this._signal) {
      this._lifetime ??= new AbortController();
      if (this._viewClosed) this._lifetime.abort(shellInputViewClosedError);
      this._signal = this._cleanupSignal === this.budget.signal
        ? AbortSignal.any([this.budget.signal, this._lifetime.signal])
        : AbortSignal.any([this.budget.signal, this._cleanupSignal, this._lifetime.signal]);
    }
    return this._signal;
  }

  private _throwIfAborted(): void {
    this.budget.signal.throwIfAborted();
    if (this._cleanupSignal !== this.budget.signal) this._cleanupSignal.throwIfAborted();
    if (this._viewClosed) throw shellInputViewClosedError;
  }

  _isViewClosed(): boolean {
    return this._viewClosed;
  }

  _addCloseWaiter(waiter: AbortSignalWaiter): void {
    if (!this._closeWaiter) this._closeWaiter = waiter;
    else (this._closeWaiters ??= new Set()).add(waiter);
  }

  _removeCloseWaiter(waiter: AbortSignalWaiter): void {
    if (this._closeWaiter === waiter) this._closeWaiter = undefined;
    else this._closeWaiters?.delete(waiter);
  }

  get bufferedBytes(): number {
    this._throwIfAborted();
    return this._cursor.bufferedBytes;
  }

  readiness(): InputReadiness {
    this._throwIfAborted();
    const readiness = this._cursor.readiness();
    this._throwIfAborted();
    return readiness;
  }

  probeRead(): ShellReadProbe {
    this._throwIfAborted();
    const result = this._cursor.probeRead();
    this._throwIfAborted();
    return result;
  }

  get position(): number { return this._cursor.position; }

  get identity(): object { return this._cursor.identity; }

  /** Return one available fragment rather than waiting to fill a native read. */
  readAvailable(maxBytes: number, callerSignal: AbortSignal): Promise<IteratorResult<Uint8Array>> {
    const signal = AbortSignal.any([this.signal, callerSignal]);
    return this._cursor.consume(signal, async () => {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid input read size");
      this._cursor.admitBoundedRead();
      if (!maxBytes) return { done: false, value: new Uint8Array() };
      const result = await this._cursor.take(signal, maxBytes);
      if (result.done) return result;
      const count = Math.min(maxBytes, result.value.byteLength);
      const value = new Uint8Array(result.value.subarray(0, count));
      if (count < result.value.byteLength) this._cursor.remainder = result.value.subarray(count);
      this._cursor.position += count;
      return { done: false, value };
    });
  }

  read(maxBytes: number, callerSignal: AbortSignal): Promise<IteratorResult<Uint8Array>> {
    const signal = AbortSignal.any([this.signal, callerSignal]);
    return this._cursor.consume(signal, async () => {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Input read size must be a nonnegative safe integer");
      this._cursor.admitBoundedRead();
      if (!maxBytes) return { done: false, value: new Uint8Array() };
      const chunks: Uint8Array[] = [];
      let length = 0;
      let pulls = 0;
      try {
        while (length < maxBytes) {
          if (++pulls % 128 === 0) {
            signal.throwIfAborted();
            this.budget.cpuCheckpoint();
            await yieldTurn(signal);
          }
          const result = await this._cursor.take(signal, maxBytes - length);
          if (result.done) break;
          const count = Math.min(maxBytes - length, result.value.byteLength);
          if (count > this.budget.limits.maxInputBytes - length) {
            this._cursor.restore([result.value]);
            this.budget.fail("maxInputBytes");
          }
          if (count < result.value.byteLength) this._cursor.remainder = result.value.subarray(count);
          if (count) chunks.push(result.value.subarray(0, count));
          length += count;
        }
        signal.throwIfAborted();
        this.budget.cpuCheckpoint();
        const value = new Uint8Array(length);
        let offset = 0;
        for (let index = 0; index < chunks.length; index++) {
          if (index && index % 128 === 0) {
            signal.throwIfAborted();
            this.budget.cpuCheckpoint();
            await yieldTurn(signal);
          }
          const chunk = chunks[index]!;
          value.set(chunk, offset);
          offset += chunk.byteLength;
        }
        signal.throwIfAborted();
        this.budget.cpuCheckpoint();
        this._cursor.position += length;
        return length ? { done: false, value } : { done: true, value: undefined };
      } catch (error) {
        this._cursor.restore(chunks);
        throw error;
      }
    });
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    try {
      this._throwIfAborted();
      const ready = this._cursor.tryTakeReadySync();
      if (ready !== undefined) {
        if (ready.done) return resolvedDoneResult;
        this._cursor.position += ready.value.byteLength;
        return Promise.resolve({ done: false, value: this._cursor.ownsChunks ? ready.value : new Uint8Array(ready.value) });
      }
    } catch (err) {
      return Promise.reject(err);
    }
    if (!this._signal && this._signalIncludesBudget) {
      return this._cursor.takeNextForView(this._cleanupSignal, this);
    }
    return this._cursor.consume(this.signal, async () => {
      const result = await this._cursor.take(this.signal);
      if (result.done) return result;
      this._cursor.position += result.value.byteLength;
      return { done: false, value: this._cursor.ownsChunks ? result.value : new Uint8Array(result.value) };
    });
  }

  tryNextSync(): IteratorResult<Uint8Array> | undefined {
    this._throwIfAborted();
    const ready = this._cursor.tryTakeReadySync();
    if (ready !== undefined) {
      if (ready.done) return doneResult;
      this._cursor.position += ready.value.byteLength;
      return { done: false, value: this._cursor.ownsChunks ? ready.value : new Uint8Array(ready.value) };
    }
    return undefined;
  }

  get abortSignal(): AbortSignal | undefined {
    return !this._signal && this._signalIncludesBudget ? this._cleanupSignal : undefined;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return this as unknown as AsyncIterableIterator<Uint8Array>;
  }

  sourceLine(): Promise<Uint8Array | undefined> {
    return this._cursor.consume(this.signal, async () => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      let pulls = 0;
      while (true) {
        if (++pulls % 128 === 0) await yieldTurn(this.signal);
        const result = await this._cursor.take(this.signal);
        if (result.done) {
          if (!length) return undefined;
          break;
        }
        const newline = result.value.indexOf(10);
        const end = newline < 0 ? result.value.length : newline + 1;
        if (end < result.value.length) this._cursor.remainder = result.value.subarray(end);
        this._cursor.position += end;
        this.budget.source(end);
        if (end) chunks.push(new Uint8Array(result.value.subarray(0, end)));
        length += end;
        if (newline >= 0) break;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    });
  }

  async record(options: RawRecordOptions = {}): Promise<RawRecord> {
    this.signal.throwIfAborted();
    const { delimiter = 10 } = options;
    this.signal.throwIfAborted();
    if (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255) throw new RangeError("Invalid raw record delimiter");
    const scope = this.budget.values.scope();
    let active = true;
    let completion: Promise<void> | undefined;
    let resolve!: () => void;
    const finish = (): void => {
      if (!completion || active) return;
      this._reads?.delete(release);
      scope.close();
      resolve();
    };
    const release = (): Promise<void> => {
      if (!completion) {
        completion = new Promise(done => { resolve = done; });
        finish();
      }
      return completion;
    };
    try {
      scope.reserve(128, 2);
      (this._reads ??= new Set()).add(release);
      const result = await this._cursor.consume(this.signal, async () => {
        const buffer = new ReadBuffer(scope, this.budget.limits.maxOutputBytes);
        let chunk: Uint8Array = new Uint8Array();
        let offset = 0;
        let pulls = 0;
        let reason: RawRecord["reason"] = "eof";
        try {
          while (true) {
            this.signal.throwIfAborted();
            if (offset === chunk.length) {
              if (++pulls % 128 === 0) await yieldTurn(this.signal);
              const next = await this._cursor.take(this.signal);
              if (next.done) break;
              chunk = next.value;
              offset = 0;
              if (!chunk.length) continue;
            }
            if (buffer.length >= this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
            const byte = chunk[offset++]!;
            this._cursor.position++;
            buffer.append(byte);
            if (byte === delimiter) { reason = "delimiter"; break; }
            if (buffer.length % 1024 === 0) await yieldTurn(this.signal);
          }
          const shellValue = shellValueFromBytes(buffer.bytes(), scope);
          this.signal.throwIfAborted();
          return Object.freeze({ shellValue, reason, release });
        } finally {
          if (offset < chunk.length) this._cursor.remainder = chunk.subarray(offset);
        }
      });
      this.signal.throwIfAborted();
      return result;
    } catch (error) { void release(); this.signal.throwIfAborted(); throw error; }
    finally { active = false; finish(); }
  }

  /** Select uses read's escape rules without projecting raw REPLY bytes to text. */
  selectLine(allocation: ValueAllocation): Promise<{ value: ShellValue; terminated: boolean }> {
    return this._cursor.consume(this.signal, async () => {
      allocation.reserve(64, 0);
      const parts: ShellValue[] = [];
      let escaping = false;
      let length = 0;
      let pulls = 0;
      while (true) {
        if (++pulls % 128 === 0) await yieldTurn(this.signal);
        const result = await this._cursor.take(this.signal);
        if (result.done) return { value: concatShellValues(parts, allocation), terminated: false };
        const chunk = result.value;
        for (let offset = 0; offset < chunk.length;) {
          await yieldTurn(this.signal);
          const end = Math.min(offset + 1024, chunk.length);
          allocation.reserve(end - offset + 64, 0);
          const output = new Uint8Array(end - offset);
          let used = 0;
          let terminated = false;
          while (offset < end) {
            const byte = chunk[offset++]!;
            this._cursor.position++;
            if (++length > this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
            if (byte === 0) continue;
            if (escaping) {
              escaping = false;
              if (byte !== 10) output[used++] = byte;
            } else if (byte === 92) escaping = true;
            else if (byte === 10) { terminated = true; break; }
            else output[used++] = byte;
          }
          if (used) {
            allocation.reserve(32, 0);
            parts.push(shellValueFromBytes(output.subarray(0, used), allocation));
          }
          if (terminated) {
            if (offset < chunk.length) this._cursor.remainder = chunk.subarray(offset);
            return { value: concatShellValues(parts, allocation), terminated: true };
          }
        }
      }
    });
  }

  mapfileRecord(delimiter: number, strip: boolean, allocation: ValueAllocation): Promise<{ value: ShellValue; present: boolean }> {
    return this._cursor.consume(this.signal, async () => {
      this._cursor.admitBoundedRead();
      allocation.reserve(64, 0);
      const parts: ShellValue[] = [];
      let length = 0;
      let truncated = false;
      let pulls = 0;
      while (true) {
        if (++pulls % 128 === 0) await yieldTurn(this.signal);
        const result = await this._cursor.take(this.signal);
        if (result.done) return { value: concatShellValues(parts, allocation), present: length > 0 };
        const chunk = result.value;
        for (let offset = 0; offset < chunk.length;) {
          await yieldTurn(this.signal);
          if (length >= this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
          const end = Math.min(offset + 1024, chunk.length, offset + this.budget.limits.maxOutputBytes - length);
          allocation.reserve(end - offset + 64, 0);
          const output = new Uint8Array(end - offset);
          let used = 0;
          let terminated = false;
          while (offset < end) {
            const byte = chunk[offset++]!;
            this._cursor.position++;
            if (++length > this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
            if (byte === delimiter) {
              if (!strip && byte !== 0 && !truncated) output[used++] = byte;
              terminated = true;
              break;
            }
            if (byte === 0) truncated = true;
            if (!truncated) output[used++] = byte;
          }
          if (used) {
            allocation.reserve(32, 0);
            parts.push(shellValueFromBytes(output.subarray(0, used), allocation));
          }
          if (terminated) {
            if (offset < chunk.length) this._cursor.remainder = chunk.subarray(offset);
            return { value: concatShellValues(parts, allocation), present: true };
          }
        }
      }
    });
  }

  async line(raw: boolean, options: ReadLineOptions = {}): Promise<ReadLine> {
    const { count, delimiter = 10, byteCount = false, exact = false, timeoutMs } = options;
    this.signal.throwIfAborted();
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new RangeError("Invalid read count");
    if (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255) throw new RangeError("Invalid read delimiter");
      const scope = this.budget.values.scope();
      let active = 1;
      let closed = false;
      let completion: Promise<void> | undefined;
      let resolve!: () => void;
      const finish = (): void => {
        if (!closed || active) return;
        this._reads?.delete(release);
        scope.close();
        resolve();
      };
      const release = (): Promise<void> => {
        if (!completion) {
          completion = new Promise(done => { resolve = done; });
          closed = true;
          finish();
        }
        return completion;
      };
      const assertOpen = (): void => {
        this.signal.throwIfAborted();
        if (closed) throw new Error("Read result is closed");
        scope.assertOpen();
      };
      let chunk: Uint8Array = new Uint8Array();
      let offset = 0;
      let deadline: InputDeadline | undefined;
      try {
        scope.reserve(256, 3);
        (this._reads ??= new Set()).add(release);
        deadline = this._cursor.deadline(timeoutMs, this.signal, scope);
        const read = async (): Promise<ReadLine> => {
        try {
        const buffer = new ReadBuffer(scope, this.budget.limits.maxOutputBytes);
        const escapedByteOffsets: number[] = [];
        let escaping = false;
        let visible = true;
        let units = 0;
        let consumed = 0;
        let checkpoint = 0;
        let pulls = 0;
        let terminated = count === 0;
        const outcome: { reason: ReadLine["reason"] } = { reason: terminated ? "count" : "eof" };
        const nextByte = async (): Promise<number | undefined> => {
          this.signal.throwIfAborted();
          if (deadline?.expired()) { outcome.reason = "timeout"; return undefined; }
          while (offset === chunk.length) {
            if (++pulls % 128 === 0) await yieldTurn(this.signal);
            let result: IteratorResult<Uint8Array>;
            try { result = await this._cursor.take(deadline?.signal ?? this.signal); }
            catch (error) {
              this.signal.throwIfAborted();
              if (deadline?.expired()) { outcome.reason = "timeout"; return undefined; }
              throw error;
            }
            if (result.done) {
              if (deadline?.expired()) outcome.reason = "timeout";
              return undefined;
            }
            chunk = result.value;
            offset = 0;
            if (deadline?.expired()) { outcome.reason = "timeout"; return undefined; }
          }
          this.signal.throwIfAborted();
          this._cursor.position++;
          return chunk[offset++]!;
        };
        const account = (): void => {
          if (++consumed > this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
        };
        while (!terminated) {
          if (consumed - checkpoint >= 1024) { checkpoint = consumed; await yieldTurn(this.signal); }
          const first = await nextByte();
          if (first === undefined) {
            if (escaping && visible && !buffer.length && outcome.reason === "eof") buffer.append(1);
            break;
          }
          const quoted = escaping;
          escaping = false;
          if (quoted && first === 10) { account(); continue; }
          if (!quoted && !raw && first === 92) { account(); escaping = true; continue; }
          if (!quoted && !exact && first === delimiter) { terminated = true; outcome.reason = "delimiter"; break; }
          account();
          if (!quoted && first === 0) continue;
          if (quoted && visible && first !== 0) {
            scope.reserve(64, 2);
            escapedByteOffsets.push(buffer.length);
          }
          if (visible && first === 0) {
            if (quoted && !buffer.length) buffer.append(1);
            visible = false;
          } else if (visible) buffer.append(first);
          const width = byteCount ? 1 : utf8Length(first);
          const committedLength = buffer.length;
          for (let position = 1; position < width; position++) {
            const next = await nextByte();
            if (next === undefined) break;
            account();
            if (next === 0) visible = false;
            else if (visible) buffer.append(next);
            if (!utf8Continuation(first, position, next)) break;
          }
          if (outcome.reason === "timeout") { buffer.length = committedLength; break; }
          units++;
          if (units === count) { terminated = true; outcome.reason = "count"; }
          if (units % 1024 === 0) await yieldTurn(this.signal);
        }
        this.signal.throwIfAborted();
        deadline?.close();
        const reason = outcome.reason;
        let bytes = buffer.bytes();
        if (reason === "timeout" && (escapedByteOffsets.length || escaping && visible)) {
          const projected = new ReadBuffer(scope, this.budget.limits.maxOutputBytes);
          let escape = 0;
          for (let position = 0; position < bytes.length; position++) {
            if (escapedByteOffsets[escape] === position) {
              projected.append(1);
              escapedByteOffsets[escape++] = projected.length;
            }
            projected.append(bytes[position]!);
            if (position % 1024 === 0) await yieldTurn(this.signal);
          }
          if (escaping && visible) {
            scope.reserve(64, 2);
            escapedByteOffsets.push(projected.length);
            projected.append(1);
          }
          bytes = projected.bytes();
        }
        const shellValue = shellValueFromBytes(bytes, scope);
        const escaped = new Set<number>();
        let escapeIndex = 0;
        let characters = 0;
        for (let start = 0; start < bytes.length; start += displayWidth(bytes, start)) {
          if (escapedByteOffsets[escapeIndex] === start) { escaped.add(characters); escapeIndex++; }
          if (++characters % 1024 === 0) await yieldTurn(this.signal);
        }
        Object.freeze(escapedByteOffsets);
        const result: ReadLine = {
          value: shellValueText(shellValue), shellValue, escaped, escapedByteOffsets, terminated, reason, release,
          fields: async (ifs, maximum) => {
            assertOpen();
            active++;
            try {
            if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid read field count");
            const separators = shellValueBytes(ifs, scope);
            scope.reserve(128, 2);
            const keys = new Set<number>();
            const escapedStart = (start: number): boolean => {
              let lower = 0;
              let upper = escapedByteOffsets.length;
              while (lower < upper) {
                const middle = lower + Math.floor((upper - lower) / 2);
                const offset = escapedByteOffsets[middle]!;
                if (offset === start) return true;
                if (offset < start) lower = middle + 1;
                else upper = middle;
              }
              return false;
            };
            const width = (input: Uint8Array, start: number): number => {
              if (input === bytes && reason === "timeout" && bytes[start] === 1 && escapedStart(start + 1)) return 2;
              if (byteCount || input === bytes && escapedStart(start)) return 1;
              const length = displayWidth(input, start);
              return length === utf8Length(input[start]!) ? length : 1;
            };
            const key = (input: Uint8Array, start: number): number => {
              let value = 1;
              for (let position = start, end = start + width(input, start); position < end; position++) value = value * 257 + input[position]!;
              return value;
            };
            let steps = 0;
            for (let start = 0; start < separators.length; start += width(separators, start)) {
              const value = key(separators, start);
              if (!keys.has(value)) { scope.reserve(32, 1); keys.add(value); }
              for (let position = start, end = start + width(separators, start); position < end; position++) {
                const byteKey = 257 + separators[position]!;
                if (!keys.has(byteKey)) { scope.reserve(32, 1); keys.add(byteKey); }
              }
              if (++steps % 1024 === 0) { await yieldTurn(this.signal); assertOpen(); }
            }
            const separator = (start: number): boolean => !escapedStart(start)
              && !(reason === "timeout" && bytes[start] === 1 && escapedStart(start + 1)) && keys.has(key(bytes, start));
            const whitespace = (start: number): boolean => (bytes[start] === 32 || bytes[start] === 9 || bytes[start] === 10) && separator(start);
            let end = 0;
            for (let start = 0; start < bytes.length; start += width(bytes, start)) {
              if (!whitespace(start)) end = start + width(bytes, start);
              if (++steps % 1024 === 0) { await yieldTurn(this.signal); assertOpen(); }
            }
            let position = 0;
            const advance = (): Promise<void> | undefined => {
              assertOpen();
              position += width(bytes, position);
              if (++steps % 1024 === 0) return yieldTurn(this.signal);
              return undefined;
            };
            const fields: ReadField[] = [];
            while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
            while (position < end && fields.length < (maximum ?? Number.MAX_SAFE_INTEGER)) {
              const start = position;
              while (position < end && !separator(position)) { const pending = advance(); if (pending) await pending; }
              let fieldEnd = position;
              while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
              if (position < end && separator(position)) { const pending = advance(); if (pending) await pending; }
              while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
              if (maximum !== undefined && fields.length === maximum - 1 && position < end) fieldEnd = end;
              scope.reserve(64, 1);
              fields.push(Object.freeze({ start, end: fieldEnd, value: shellValueFromBytes(bytes.subarray(start, fieldEnd), scope) }));
            }
            assertOpen();
            return Object.freeze(fields);
            } finally { active--; finish(); }
          },
        };
        assertOpen();
        return Object.freeze(result);
        } finally {
          if (offset < chunk.length) this._cursor.remainder = chunk.subarray(offset);
        }
        };
        const result = await this._cursor.consume(deadline?.signal ?? this.signal, read, async error => {
          this.signal.throwIfAborted();
          if (deadline?.expired()) return read();
          throw error;
        });
        this.signal.throwIfAborted();
        return result;
      } catch (error) { void release(); this.signal.throwIfAborted(); throw error; }
      finally {
        deadline?.close();
        active--;
        finish();
      }
  }

  close(): Promise<void> {
    if (!this._closing) {
      this._viewClosed = true;
      this._lifetime?.abort(shellInputViewClosedError);
      if (this._closeWaiter) {
        const waiter = this._closeWaiter;
        this._closeWaiter = undefined;
        if (typeof waiter === "function") waiter(shellInputViewClosedError);
        else waiter.onAbort(shellInputViewClosedError);
      }
      if (this._closeWaiters?.size) {
        for (const reject of this._closeWaiters) {
          if (typeof reject === "function") reject(shellInputViewClosedError);
          else reject.onAbort(shellInputViewClosedError);
        }
        this._closeWaiters.clear();
      }
      const readsSize = this._reads?.size ?? 0;
      if (readsSize === 0 && (!this._owned || !this._lazyCursor)) {
        this._closing = resolvedVoid;
        return resolvedVoid;
      }
      if (readsSize === 0 && this._owned && this._cursor.canCloseSync()) {
        try {
          this._cursor.closeSync(this._cleanupSignal);
          this._closing = resolvedVoid;
        } catch (err) {
          this._closing = Promise.reject(err);
        }
        return this._closing;
      }
      const pending = this._reads ? [...this._reads].map(release => release()) : [];
      if (this._owned) pending.push(this._cursor.close(this._cleanupSignal));
      this._closing = Promise.all(pending).then(() => undefined);
    }
    return this._closing;
  }
}
