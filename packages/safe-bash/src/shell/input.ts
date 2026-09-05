import { FsError, toByteSource } from "../contracts/index.js";
import type { ByteSource, FileSystem } from "../contracts/index.js";
import { monotonicNow, yieldTurn } from "../contracts/yield.js";
import { Budget, interruptible } from "./runtime.js";
import { shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueReservation } from "../contracts/value.js";
import type { ValueScope } from "./value-state.js";
import type { CommandContext } from "../contracts/command.js";
import { openCommandFile, type CommandFileDescriptor } from "../contracts/filesystem-descriptor.js";

export interface PreparedShellInput {
  readonly source: ByteSource;
  readonly options: Pick<ShellInputOptions, "provenance" | "poll" | "eof">;
  close(): Promise<void>;
}

const inputBuffers = new WeakMap<Budget, Set<InputBufferLease>>();
const inputByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, "byteLength")!.get!;

export function inputBufferUsage(budget: Budget): Readonly<{ bytes: number; buffers: number }> {
  let bytes = 0;
  const leases = inputBuffers.get(budget);
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
    let leases = inputBuffers.get(budget);
    if (!leases) { leases = new Set(); inputBuffers.set(budget, leases); }
    leases.add(this);
    try {
      this.bytes = allocate();
      budget.signal.throwIfAborted();
    } catch (error) { this.release(); budget.signal.throwIfAborted(); throw error; }
  }

  release(): void {
    this.bytes = undefined;
    const leases = inputBuffers.get(this.budget);
    leases?.delete(this);
    if (!leases?.size) inputBuffers.delete(this.budget);
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
    budget.signal.removeEventListener("abort", aborted);
    return closing ??= Promise.resolve();
  };
  const aborted = (): void => { void close(); };
  try {
    if (length) {
      buffer = new InputBufferLease(budget, length, () => typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value));
    }
    budget.signal.addEventListener("abort", aborted, { once: true });
    const source: AsyncIterableIterator<Uint8Array> = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        budget.signal.throwIfAborted();
        const bytes = buffer?.bytes;
        if (closed || sent || !bytes?.byteLength) return { done: true, value: undefined };
        sent = true;
        return { done: false, value: bytes };
      },
      async return() { await close(); return { done: true, value: undefined }; },
    };
    return Object.freeze({ source, close, options: Object.freeze({ provenance: "stream", poll: () => {
      budget.signal.throwIfAborted();
      if (closed) throw new Error("Prepared input is closed");
      return !sent && length ? "ready" : "eof";
    } }) });
  } catch (error) { void close(); throw error; }
}

export async function prepareFileInput(
  context: Pick<CommandContext, "fs" | "signal"> & Required<Pick<CommandContext, "registerCleanup">>,
  path: string,
  budget: Budget,
): Promise<PreparedShellInput> {
  const { fs, signal: parent, registerCleanup: register } = context;
  const registerCleanup = register.bind(context);
  const signal = AbortSignal.any([parent, budget.signal]);
  const readerController = new AbortController();
  const readSignal = AbortSignal.any([signal, readerController.signal]);
  let descriptor: CommandFileDescriptor | undefined;
  let legacy: AsyncIterator<Uint8Array> | undefined;
  let accepting = true;
  let ended = false;
  let buffer: InputBufferLease | undefined;
  let size = 0;
  let work: Promise<void> = Promise.resolve();
  let admitted!: () => void;
  const acquisition = new Promise<void>(resolve => { admitted = resolve; });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    accepting = false;
    if (!readerController.signal.aborted) readerController.abort(new FsError("EBADF", { syscall: "read", path }));
    closing ??= (async () => {
      await acquisition;
      await work;
      try {
        if (descriptor) await descriptor.close();
        else await legacy?.return?.();
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      } finally {
        descriptor = undefined;
        legacy = undefined;
        buffer?.release();
        buffer = undefined;
        signal.removeEventListener("abort", aborted);
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
    registerCleanup(close);
    signal.addEventListener("abort", aborted, { once: true });
    check();
    let provenance: NonNullable<ShellInputOptions["provenance"]> = "unknown";
    try { descriptor = await openCommandFile({ fs, signal, registerCleanup }, path, { access: "read", signal }); }
    catch (error) {
      check();
      if (!(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
      const source = await fileInput(fs, path, budget.limits.maxInputBytes, readSignal);
      legacy = source[Symbol.asyncIterator]();
    }
    check();
    if (descriptor) {
      const stat = await descriptor.stat({ signal });
      check();
      if (stat.type === "directory") throw new FsError("EISDIR", { syscall: "read", path });
      provenance = stat.type === "file" ? "regular" : stat.type === "character" ? "stream" : "unknown";
    }
    const source: AsyncIterableIterator<Uint8Array> = {
      [Symbol.asyncIterator]() { return this; },
      next() {
        try { signal.throwIfAborted(); if (ended) return Promise.resolve({ done: true, value: undefined }); check(); }
        catch (error) { return Promise.reject(error); }
        const operation = work.then(async (): Promise<IteratorResult<Uint8Array>> => {
          signal.throwIfAborted();
          if (ended) return { done: true, value: undefined };
          check();
          if (legacy) {
            const result = await legacy.next();
            check();
            ended = result.done === true;
            return result;
          }
          if (!buffer) {
            const capacity = Math.min(64 * 1024, budget.limits.maxInputBytes) || 1;
            buffer = new InputBufferLease(budget, capacity, () => new Uint8Array(capacity));
          }
          const bytes = buffer.bytes!;
          const remaining = budget.limits.maxInputBytes - size;
          const chunk = bytes.subarray(0, remaining >= bytes.length ? bytes.length : remaining + 1);
          const length = await descriptor!.read(chunk, null, { signal: readSignal });
          check();
          if (!Number.isSafeInteger(length) || length < 0 || length > chunk.length) throw new FsError("EIO", { syscall: "read", path });
          if (length > budget.limits.maxInputBytes - size) throw new FsError("EFBIG", { syscall: "read", path });
          size += length;
          const done = length === 0;
          ended = done && provenance !== "regular";
          return done ? { done: true, value: undefined } : { done: false, value: chunk.subarray(0, length) };
        });
        work = operation.then(() => {}, () => {});
        return operation.then(async result => {
          if (result.done && provenance !== "regular") await close();
          signal.throwIfAborted();
          return result;
        }, async error => {
          try { await close(); } catch {}
          signal.throwIfAborted();
          throw error;
        });
      },
      async return() { await close(); return { done: true, value: undefined }; },
    };
    admitted();
    return Object.freeze({ source, close, options: Object.freeze({ provenance, eof: provenance === "regular" ? "retryable" : "terminal" }) });
  } catch (error) {
    admitted();
    try { await close(); } catch {}
    signal.throwIfAborted();
    throw error;
  }
}

export async function fileInput(fs: FileSystem, path: string, maxBytes: number, signal: AbortSignal): Promise<ByteSource> {
  signal.throwIfAborted();
  async function bufferedInput(): Promise<ByteSource> {
    signal.throwIfAborted();
    const bytes = await interruptible(fs.readFile(path, { signal, maxBytes }), signal);
    signal.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw new FsError("EFBIG", { syscall: "readFile", path });
    return toByteSource(bytes);
  }
  const readStream = fs.readStream;
  if (!readStream || fs.capabilities.streamingRead === false) return bufferedInput();
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
  readonly provenance?: "regular" | "stream" | "unknown";
  readonly eof?: "terminal" | "retryable";
  readonly poll?: () => InputReadiness;
  readonly clock?: InputClock;
}

const inputClock: InputClock = {
  now: monotonicNow,
  schedule(delayMs, expire) {
    const timer = setTimeout(expire, Math.min(delayMs, 2_147_483_647));
    return () => clearTimeout(timer);
  },
};

class InputDeadline {
  readonly #controller = new AbortController();
  readonly #expiresAt: number;
  #cancel: (() => void) | undefined;
  #closed = false;
  readonly signal: AbortSignal;

  constructor(readonly clock: InputClock, timeoutMs: number, readonly parent: AbortSignal) {
    const now = clock.now();
    this.#expiresAt = now + timeoutMs;
    if (!Number.isFinite(now) || !Number.isFinite(this.#expiresAt)) throw new RangeError("Invalid input clock deadline");
    this.signal = AbortSignal.any([parent, this.#controller.signal]);
    parent.throwIfAborted();
    parent.addEventListener("abort", this.close, { once: true });
    try { this.#schedule(); } catch (error) { this.close(); throw error; }
  }

  expired(): boolean {
    this.parent.throwIfAborted();
    if (!this.#closed && this.clock.now() >= this.#expiresAt) {
      this.#controller.abort();
      this.close();
    }
    return this.#controller.signal.aborted;
  }

  #schedule(): void {
    const cancel = this.clock.schedule(Math.max(0, this.#expiresAt - this.clock.now()), () => {
      this.#cancel = undefined;
      if (this.#closed || this.parent.aborted) return;
      if (!this.expired()) this.#schedule();
    });
    if (this.#closed) cancel();
    else this.#cancel = cancel;
  }

  readonly close = (): void => {
    this.#closed = true;
    const cancel = this.#cancel;
    this.#cancel = undefined;
    this.parent.removeEventListener("abort", this.close);
    try { cancel?.(); }
    catch (error) { if (!this.parent.aborted) throw error; }
  };
}

class InputCursor {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #provenance: "regular" | "stream" | "unknown";
  readonly #eof: "terminal" | "retryable";
  readonly #poll: (() => InputReadiness) | undefined;
  readonly #clock: InputClock;
  remainder: Uint8Array | undefined;
  #read: Promise<IteratorResult<Uint8Array>> | undefined;
  #readResult: IteratorResult<Uint8Array> | undefined;
  #readError: { reason: unknown } | undefined;
  #readSettled = false;
  #readFailed = false;
  #turn = Promise.resolve();
  #returned: Promise<void> | undefined;
  #ended = false;
  #closed = false;
  #active = false;

  constructor(source: ByteSource, options: ShellInputOptions = {}) {
    const { provenance = "unknown", eof = "terminal", poll, clock = inputClock } = options;
    if (provenance !== "unknown" && provenance !== "regular" && provenance !== "stream") throw new TypeError("Invalid input provenance");
    if (eof !== "terminal" && eof !== "retryable" || eof === "retryable" && provenance !== "regular") throw new TypeError("Retryable input EOF requires regular provenance");
    if (poll !== undefined && typeof poll !== "function") throw new TypeError("Invalid input polling capability");
    const { now, schedule } = clock;
    if (typeof now !== "function" || typeof schedule !== "function") throw new TypeError("Invalid input clock");
    this.#provenance = provenance;
    this.#eof = eof;
    this.#poll = poll?.bind(options);
    this.#clock = Object.freeze({ now: now.bind(clock), schedule: schedule.bind(clock) });
    this.#iterator = source[Symbol.asyncIterator]();
  }

  readiness(): InputReadiness {
    if (this.#active) return "blocked";
    if (this.remainder?.length) return "ready";
    if (this.#readError) throw this.#readError.reason;
    if (this.#ended || this.#readResult?.done) return "eof";
    if (this.#readResult && this.#readResult.value.length) return "ready";
    if (this.#closed) throw new Error("Shell input cursor is closed");
    if (this.#provenance === "regular") return "ready";
    const readiness = this.#poll?.() ?? "unknown";
    if (!["ready", "eof", "blocked", "unknown"].includes(readiness)) throw new TypeError("Invalid input readiness");
    if (readiness === "eof" && this.#read && !this.#readSettled) return "unknown";
    return readiness;
  }

  deadline(timeoutMs: number | undefined, signal: AbortSignal, scope: ValueScope): InputDeadline | undefined {
    if (timeoutMs === undefined) return undefined;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Read timeout must be positive and finite; use readiness for zero timeout");
    if (this.#provenance === "unknown") throw new TypeError("Read timeout requires explicit input provenance");
    if (this.#provenance === "regular") return undefined;
    scope.reserve(192, 3);
    return new InputDeadline(this.#clock, timeoutMs, signal);
  }

  async consume<Value>(signal: AbortSignal, operation: () => Promise<Value>, interrupted?: (error: unknown) => Promise<Value>): Promise<Value> {
    if (signal.aborted && interrupted) return interrupted(signal.reason);
    signal.throwIfAborted();
    const previous = this.#turn;
    let release!: () => void;
    const completed = new Promise<void>((resolve) => { release = resolve; });
    this.#turn = previous.then(() => completed);
    try {
      try { await interruptible(previous, signal); signal.throwIfAborted(); }
      catch (error) { if (signal.aborted && interrupted) return await interrupted(error); throw error; }
      if (this.#eof === "retryable") this.#ended = false;
      this.#active = true;
      try { return await operation(); }
      finally { this.#active = false; }
    } finally { release(); }
  }

  async take(signal: AbortSignal): Promise<IteratorResult<Uint8Array>> {
    signal.throwIfAborted();
    if (this.remainder) {
      const value = this.remainder;
      this.remainder = undefined;
      return { value, done: false };
    }
    if (this.#ended || this.#closed) return { value: undefined, done: true };
    if (!this.#read) {
      this.#readSettled = false;
      this.#readResult = undefined;
      this.#read = Promise.resolve().then(() => this.#closed ? { value: undefined, done: true as const } : this.#iterator.next()).then((result) => {
        if (result.done) return { value: undefined, done: true };
        if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
        return { value: result.value, done: false };
      });
      void this.#read.then(result => { this.#readSettled = true; this.#readResult = result; }, reason => { this.#readSettled = true; this.#readError = { reason }; });
    }
    try {
      const result = await interruptible(this.#read, signal);
      signal.throwIfAborted();
      this.#read = undefined;
      this.#readResult = undefined;
      if (result.done) this.#ended = true;
      return result;
    } catch (error) {
      if (!signal.aborted) { this.#read = undefined; this.#readFailed = true; this.#closed = true; }
      throw error;
    }
  }

  async close(signal: AbortSignal): Promise<void> {
    if (this.#ended && this.#eof === "terminal") { signal.throwIfAborted(); return; }
    this.#closed = true;
    this.remainder = undefined;
    const pendingRead = this.#read !== undefined && !this.#readSettled;
    this.#returned ??= Promise.resolve().then(() => this.#iterator.return?.()).then(() => undefined);
    void this.#returned.catch(() => undefined);
    if (!pendingRead) {
      try { await interruptible(this.#returned, signal); }
      catch (error) { if (!this.#readFailed) throw error; }
    }
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
  #buffer: Uint8Array = new Uint8Array();
  #reservation: ValueReservation | undefined;
  length = 0;

  constructor(readonly scope: ValueScope, readonly maximum: number) {}

  append(byte: number): void {
    if (this.length === this.#buffer.length) {
      const capacity = Math.min(this.maximum, Math.max(64, this.#buffer.length * 2));
      const reservation = this.scope.reserve(capacity + 64, 1);
      try {
        const buffer = new Uint8Array(capacity);
        buffer.set(this.#buffer);
        reservation.commit(buffer);
        this.#reservation?.release();
        this.#reservation = reservation;
        this.#buffer = buffer;
      } catch (error) { reservation.release(); throw error; }
    }
    this.#buffer[this.length++] = byte;
  }

  bytes(): Uint8Array { return this.#buffer.subarray(0, this.length); }
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

export class ShellInput implements ByteSource {
  readonly #cursor: InputCursor;
  readonly #owned: boolean;
  readonly #lifetime = new AbortController();
  readonly #cleanupSignal: AbortSignal;
  readonly signal: AbortSignal;
  readonly #reads = new Set<() => Promise<void>>();
  #closing: Promise<void> | undefined;

  constructor(source: ByteSource, readonly budget: Budget, signal = budget.signal, options?: ShellInputOptions) {
    this.#owned = !(source instanceof ShellInput);
    if (!this.#owned && options !== undefined) throw new TypeError("Borrowed input cannot replace cursor capabilities");
    this.#cursor = source instanceof ShellInput ? source.#cursor : new InputCursor(source, options);
    this.#cleanupSignal = signal;
    this.signal = AbortSignal.any([budget.signal, signal, this.#lifetime.signal]);
  }

  readiness(): InputReadiness {
    this.signal.throwIfAborted();
    const readiness = this.#cursor.readiness();
    this.signal.throwIfAborted();
    return readiness;
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    return this.#cursor.consume(this.signal, () => this.#cursor.take(this.signal));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return { next: () => this.next(), [Symbol.asyncIterator]() { return this; } };
  }

  sourceLine(): Promise<Uint8Array | undefined> {
    return this.#cursor.consume(this.signal, async () => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      let pulls = 0;
      while (true) {
        if (++pulls % 128 === 0) await yieldTurn(this.signal);
        const result = await this.#cursor.take(this.signal);
        if (result.done) {
          if (!length) return undefined;
          break;
        }
        const newline = result.value.indexOf(10);
        const end = newline < 0 ? result.value.length : newline + 1;
        if (end < result.value.length) this.#cursor.remainder = result.value.subarray(end);
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
      this.#reads.delete(release);
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
      this.#reads.add(release);
      const result = await this.#cursor.consume(this.signal, async () => {
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
              const next = await this.#cursor.take(this.signal);
              if (next.done) break;
              chunk = next.value;
              offset = 0;
              if (!chunk.length) continue;
            }
            if (buffer.length >= this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
            const byte = chunk[offset++]!;
            buffer.append(byte);
            if (byte === delimiter) { reason = "delimiter"; break; }
            if (buffer.length % 1024 === 0) await yieldTurn(this.signal);
          }
          const shellValue = shellValueFromBytes(buffer.bytes(), scope);
          this.signal.throwIfAborted();
          return Object.freeze({ shellValue, reason, release });
        } finally {
          if (offset < chunk.length) this.#cursor.remainder = chunk.subarray(offset);
        }
      });
      this.signal.throwIfAborted();
      return result;
    } catch (error) { void release(); this.signal.throwIfAborted(); throw error; }
    finally { active = false; finish(); }
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
        this.#reads.delete(release);
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
        this.#reads.add(release);
        deadline = this.#cursor.deadline(timeoutMs, this.signal, scope);
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
            try { result = await this.#cursor.take(deadline?.signal ?? this.signal); }
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
          if (offset < chunk.length) this.#cursor.remainder = chunk.subarray(offset);
        }
        };
        const result = await this.#cursor.consume(deadline?.signal ?? this.signal, read, async error => {
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
    if (!this.#closing) {
      this.#lifetime.abort(new Error("Shell input view closed"));
      const pending = [...this.#reads].map(release => release());
      if (this.#owned) pending.push(this.#cursor.close(this.#cleanupSignal));
      this.#closing = Promise.all(pending).then(() => undefined);
    }
    return this.#closing;
  }
}
