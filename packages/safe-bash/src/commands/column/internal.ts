import { publicDiagnosticMessage } from "../../diagnostics.js";
import { hasYieldCheckpoint, monotonicNow, runYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { escapeText } from "../../escaping.js";
import { FsError, writeBytes, type ByteSource, type CommandContext, type FileSystem, type ReadStreamOptions } from "../../contracts/index.js";
import { Budget, Inputs, type RecordReader } from "../table-text/internal.js";
import { readerSettings, type ColumnLimits } from "./options.js";

export function diagnostics(context: CommandContext, maximum: number): (error: unknown) => Promise<void> {
  let remaining = maximum;
  return async error => {
    context.signal.throwIfAborted();
    if (!remaining) return;
    const message = publicDiagnosticMessage(error, context.onInternalError);
    const prefix = "column: ", marker = "...[diagnostic truncated]\n";
    const candidate = prefix + escapeText(message.slice(0, remaining), "diagnostic") + "\n";
    let bytes = Buffer.from(candidate);
    if (message.length > remaining || bytes.length > remaining) {
      const suffix = Buffer.from(marker.slice(0, remaining));
      let end = Math.min(bytes.length, remaining - suffix.length);
      while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
      bytes = Buffer.concat([bytes.subarray(0, end), suffix]);
    }
    remaining -= bytes.length;
    await writeBytes(context.stderr, bytes, context.signal);
  };
}

export class ColumnBudget extends Budget {
  static readonly outputChunkBytes = 8192;
  private workUsed = 0;
  private untilYield = 2048;
  private lastYield = monotonicNow();
  private yieldedOnce = false;
  private emittedBytes = 0;
  private retainedBytes = 0;
  private projectedBytes = 0;
  private aborted = false;
  private readonly pollSignal: boolean;
  constructor(context: CommandContext, readonly columnLimits: ColumnLimits) {
    super(context, readerSettings(columnLimits), ColumnBudget.outputChunkBytes);
    const sig = context.signal;
    this.pollSignal = typeof sig.addEventListener !== "function" || Object.prototype.hasOwnProperty.call(sig, "aborted");
    if (sig.aborted) this.aborted = true;
    else if (!this.pollSignal) sig.addEventListener("abort", () => { this.aborted = true; }, { once: true });
  }
  override check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new FsError("EFBIG", { message: `column ${label} limit exceeded` });
    }
  }
  override step(): void | Promise<void> { return this.work(1); }
  retain(length: number): void {
    // Charge strings, worst-case tab expansion, and field/cell bookkeeping
    // before slicing input or constructing display cells. This is a logical
    // retention budget, not an engine-specific heap measurement.
    const size = 64 + length * 16;
    this.check(size, this.columnLimits.maxRetainedBytes - this.retainedBytes, "retention");
    this.retainedBytes += size;
  }
  project(size: number): void {
    this.check(size, this.columnLimits.maxOutputBytes - this.projectedBytes, "output projection");
    this.projectedBytes += size;
  }
  work(amount: number): void | Promise<void> {
    if (this.aborted || (this.pollSignal && this.context.signal.aborted)) { this.aborted = true; this.context.signal.throwIfAborted(); }
    this.check(amount, this.columnLimits.maxSteps - this.workUsed, "work");
    this.workUsed += amount;
    this.untilYield -= amount;
    if (this.untilYield > 0) return;
    this.untilYield = 2048;
    runYieldCheckpoint(this.context.signal);
    const now = monotonicNow();
    if (this.yieldedOnce && now - this.lastYield < 16 && !hasYieldCheckpoint(this.context.signal)) return;
    this.yieldedOnce = true;
    this.lastYield = now;
    return yieldTurn(this.context.signal).then(() => {
      this.lastYield = monotonicNow();
      this.context.signal.throwIfAborted();
    });
  }
  async text(value: string): Promise<void> {
    this.check(value.length, this.columnLimits.maxOutputBytes - this.emittedBytes, "output");
    const size = Buffer.byteLength(value);
    this.check(size, this.columnLimits.maxOutputBytes - this.emittedBytes, "output");
    const bytes = Buffer.from(value);
    if (!size) await this.output([]);
    for (let offset = 0; offset < size; offset += ColumnBudget.outputChunkBytes) {
      await this.chunk(bytes.subarray(offset, offset + ColumnBudget.outputChunkBytes));
    }
  }
  checkOutput(size: number, label = "output padding"): void {
    this.check(size, this.columnLimits.maxOutputBytes - this.emittedBytes, label);
  }
  async chunk(bytes: Uint8Array): Promise<void> {
    this.checkOutput(bytes.length, "output");
    this.emittedBytes += bytes.length;
    await this.output([bytes]);
    // Column's admitted chunks are also its backpressure boundaries. Do not
    // let the shared table-text buffer combine them into larger sink writes.
    await this.flushOutput();
  }
  async padding(size: number, character = " "): Promise<void> {
    this.checkOutput(size);
    { const w = this.work(size); if (w) await w; }
    for (let remaining = size; remaining > 0; remaining -= ColumnBudget.outputChunkBytes) {
      await this.text(character.repeat(Math.min(remaining, ColumnBudget.outputChunkBytes)));
    }
  }
}

const columnSignalWaiters = new WeakMap<AbortSignal, Set<() => void>>();
function getColumnSignalWaiters(signal: AbortSignal): Set<() => void> {
  let waiters = columnSignalWaiters.get(signal);
  if (!waiters) {
    waiters = new Set();
    columnSignalWaiters.set(signal, waiters);
    signal.addEventListener("abort", () => {
      const pending = [...waiters!];
      waiters!.clear();
      for (const fn of pending) fn();
    }, { once: true });
  }
  return waiters;
}

function cancellable<Result>(operation: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  const waiters = getColumnSignalWaiters(signal);
  return new Promise<Result>((resolve, reject) => {
    const onAbort = (): void => { waiters.delete(onAbort); reject(signal.reason); };
    waiters.add(onAbort);
    try {
      Promise.resolve(operation()).then(value => {
        waiters.delete(onAbort);
        if (signal.aborted) reject(signal.reason); else resolve(value);
      }, error => { waiters.delete(onAbort); reject(error); });
    } catch (error) { waiters.delete(onAbort); reject(error); }
  });
}

export class ColumnInputs {
  private readonly controller = new AbortController();
  private readonly inputs: Inputs;
  private readonly acquired: (() => Promise<void>)[] = [];
  private readonly opening = new Set<Promise<RecordReader>>();
  private closed = false;
  private completion: Promise<void> | undefined;
  readonly signal: AbortSignal;
  readonly budget: ColumnBudget;

  constructor(context: CommandContext, limits: ColumnLimits) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    const fs = new Proxy(context.fs, { get: (target, key) => {
      if (key === "stat") return (path: string) => cancellable(() => target.stat(path, { signal: this.signal }), this.signal);
      if (key === "readStream") return target.readStream ? (path: string, options?: ReadStreamOptions) => {
        this.admit();
        return this.manage(target.readStream!(path, { ...options, signal: this.signal }));
      } : undefined;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    const stdin: ByteSource = { [Symbol.asyncIterator]: () => this.manage(context.stdin)[Symbol.asyncIterator]() };
    const scoped = new Proxy({ fs, stdin, signal: this.signal } as CommandContext, {
      get(target, key) {
        if (Object.hasOwn(target, key)) return Reflect.get(target, key, target);
        const value: unknown = Reflect.get(context, key, context);
        return typeof value === "function" ? value.bind(context) : value;
      },
    });
    this.budget = new ColumnBudget(scoped, limits);
    this.inputs = new Inputs(scoped, this.budget, 10);
    context.registerCleanup?.(this.close);
  }

  private admit(): void {
    this.signal.throwIfAborted();
    if (this.closed) throw new FsError("EPIPE", { message: "column input admission closed" });
  }

  private manage(source: ByteSource): ByteSource {
    this.admit();
    const iterator = source[Symbol.asyncIterator]();
    let done = false, completion: Promise<void> | undefined;
    const close = (): Promise<void> => {
      completion ??= Promise.resolve().then(async () => {
        if (!done) { done = true; await iterator.return?.(); }
      });
      return completion;
    };
    this.acquired.push(close);
    return { [Symbol.asyncIterator]() { return {
      async next() {
        if (done) return { done: true, value: undefined };
        const result = await iterator.next();
        if (result.done) done = true;
        return result;
      },
      async return() { await close(); return { done: true, value: undefined }; },
    }; } };
  }

  async open(name: string): Promise<RecordReader> {
    this.admit();
    const pending = this.inputs.open(name);
    this.opening.add(pending);
    try { return await pending; }
    finally { this.opening.delete(pending); }
  }

  readonly close = (): Promise<void> => {
    if (this.completion) return this.completion;
    this.closed = true;
    this.completion = Promise.resolve().then(async () => {
      let flushError: { error: unknown } | undefined;
      if (!this.signal.aborted && this.budget.hasPendingOutput()) {
        try { await this.budget.flushOutput(); } catch (error) { flushError = { error }; }
      }
      this.controller.abort(new FsError("EPIPE", { message: "column input transfer ended" }));
      await Promise.allSettled(this.opening);
      const results = await Promise.allSettled([this.inputs.close(), ...this.acquired.map(close => close())]);
      if (flushError) throw flushError.error;
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
    return this.completion;
  };
}
