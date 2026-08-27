import { FsError, writeBytes, type ByteSource, type CommandContext, type FileSystem, type ReadStreamOptions } from "../../contracts/index.js";
import { Budget, Inputs, type RecordReader } from "../table-text/internal.js";
import { readerSettings, type ColumnLimits } from "./options.js";

export function diagnostics(context: CommandContext, maximum: number): (error: unknown) => Promise<void> {
  let remaining = maximum;
  return async error => {
    context.signal.throwIfAborted();
    if (!remaining) return;
    const message = error instanceof Error ? error.message : String(error);
    const prefix = "column: ", marker = "...[diagnostic truncated]\n";
    const candidate = prefix + message.slice(0, remaining) + "\n";
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
  private untilYield = 128;
  private emittedBytes = 0;
  constructor(context: CommandContext, readonly columnLimits: ColumnLimits) {
    super(context, readerSettings(columnLimits));
  }
  override check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new FsError("EFBIG", { message: `column ${label} limit exceeded` });
    }
  }
  override async step(): Promise<void> { await this.work(1); }
  async work(amount: number): Promise<void> {
    this.context.signal.throwIfAborted();
    this.check(amount, this.columnLimits.maxSteps - this.workUsed, "work");
    this.workUsed += amount;
    this.untilYield -= amount;
    if (this.untilYield <= 0) {
      this.untilYield = 128;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    this.context.signal.throwIfAborted();
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
  }
  async padding(size: number, character = " "): Promise<void> {
    this.checkOutput(size);
    await this.work(size);
    for (let remaining = size; remaining > 0; remaining -= ColumnBudget.outputChunkBytes) {
      await this.text(character.repeat(Math.min(remaining, ColumnBudget.outputChunkBytes)));
    }
  }
}

function cancellable<Result>(operation: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const onAbort = (): void => { signal.removeEventListener("abort", onAbort); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      Promise.resolve(operation()).then(value => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(signal.reason); else resolve(value);
      }, error => { signal.removeEventListener("abort", onAbort); reject(error); });
    } catch (error) { signal.removeEventListener("abort", onAbort); reject(error); }
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
      this.controller.abort(new FsError("EPIPE", { message: "column input transfer ended" }));
      await Promise.allSettled(this.opening);
      const results = await Promise.allSettled([this.inputs.close(), ...this.acquired.map(close => close())]);
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
    return this.completion;
  };
}
