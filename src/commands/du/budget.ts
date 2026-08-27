import { FsError, writeBytes, type ByteSink, type CommandContext } from "../../contracts/index.js";
import type { DuLimits } from "./options.js";

export class DuLimitError extends FsError {
  constructor(label: string) { super("EFBIG", { message: `du ${label} limit exceeded` }); }
}

export class Budget {
  private steps = 0;
  private entries = 0;
  private metadata = 0;
  private output = 0;
  private operations = 0;
  private closed = false;
  private completion: Promise<void> | undefined;
  private readonly cancellation = new AbortController();
  private readonly ioSignal: AbortSignal;
  private outputSignal: AbortSignal | undefined;
  private readonly work = new Set<Promise<unknown>>();
  private readonly pending = new Set<() => void>();
  private readonly timers = new Set<ReturnType<typeof setImmediate>>();

  constructor(readonly context: CommandContext, readonly limits: DuLimits, readonly caller: CommandContext = context) {
    this.ioSignal = AbortSignal.any([caller.signal, this.cancellation.signal]);
  }

  readonly close = (): Promise<void> => {
    if (this.completion) return this.completion;
    this.closed = true;
    this.cancellation.abort(this.context.signal.aborted ? this.context.signal.reason : new Error("du invocation closed"));
    for (const timer of this.timers) clearImmediate(timer);
    this.timers.clear();
    for (const cancel of this.pending) {
      this.context.signal.removeEventListener("abort", cancel);
      cancel();
    }
    this.pending.clear();
    this.completion = Promise.allSettled([...this.work]).then(() => {});
    return this.completion;
  };

  private track<Result>(promise: Promise<Result>): Promise<Result> {
    this.work.add(promise);
    void promise.then(() => this.work.delete(promise), () => this.work.delete(promise));
    return promise;
  }

  active(signal = this.context.signal): void {
    signal.throwIfAborted();
    if (this.closed) throw new Error("du invocation closed");
  }

  check(value: number, maximum: number, label: string, signal = this.context.signal): void {
    this.active(signal);
    if (!Number.isSafeInteger(value) || value > maximum) throw new DuLimitError(label);
  }

  step(count = 1): void {
    this.check(count, this.limits.maxSteps - this.steps, "work");
    this.steps += count;
  }

  entry(): void { this.check(++this.entries, this.limits.maxEntries, "entry"); }

  text(value: string): void {
    this.check(value.length, this.limits.maxPathBytes, "path/name");
    this.step(value.length + 1);
    const bytes = Buffer.byteLength(value);
    this.check(bytes, this.limits.maxPathBytes, "path/name");
    this.check(bytes, this.limits.maxMetadataBytes - this.metadata, "metadata");
    this.metadata += bytes;
  }

  wait<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.active();
    return this.track(this.waitTask(operation));
  }

  private async waitTask<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.active();
    const { signal } = this.context;
    let cancel!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(signal.aborted ? signal.reason : new Error("du invocation closed"));
      signal.addEventListener("abort", cancel, { once: true });
      this.pending.add(cancel);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => { this.active(); return operation(); }), aborted]);
      this.active();
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
      this.pending.delete(cancel);
    }
  }

  async fs<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.step();
    if (++this.operations % 64 === 0) {
      await this.wait(() => new Promise<void>(resolve => {
        const timer = setImmediate(() => { this.timers.delete(timer); resolve(); });
        this.timers.add(timer);
      }));
    }
    return this.wait(operation);
  }

  async emit(sink: ByteSink, text: string, signal = this.context.signal): Promise<void> {
    this.check(text.length, this.limits.maxOutputBytes - this.output, "output", signal);
    const size = Buffer.byteLength(text);
    this.check(size, this.limits.maxOutputBytes - this.output, "output", signal);
    this.output += size;
    const bytes = new TextEncoder().encode(text);
    const ioSignal = signal === this.caller.signal ? this.ioSignal : (this.outputSignal ??= AbortSignal.any([signal, this.cancellation.signal]));
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      this.active(signal);
      await this.track(writeBytes(sink, bytes.slice(offset, offset + 16384), ioSignal));
    }
  }

  async diagnostic(error: unknown, path?: string): Promise<void> {
    this.active(this.caller.signal);
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "filesystem operation failed";
    const maximum = 4096;
    const short = raw.length > maximum ? raw.slice(0, maximum) + " [diagnostic truncated]" : raw;
    const message = short.replace(/^[A-Z][A-Z0-9]+: /u, "");
    const location = path === undefined ? "" : `${JSON.stringify(path)}: `;
    await this.emit(this.caller.stderr, `du: ${location}${message.replace(/[\x00-\x1f\x7f]/gu, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`)}\n`, this.caller.signal);
  }
}
