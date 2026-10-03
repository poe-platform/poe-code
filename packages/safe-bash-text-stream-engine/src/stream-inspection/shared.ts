import { readFileStream } from "safe-bash-contracts/filesystem";
import { utf8ByteLength } from "safe-bash-byte-engine";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { createBufferedOutput, FsError, readBytes, type ByteSource, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { diagnostic, pathOf } from "safe-bash-io-engine/internal";
import { gnuInformation } from "safe-bash-io-engine/gnu-information";

export interface StreamInspectionLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRecordBytes: number;
  readonly maxChunkBytes: number;
  readonly maxFiles: number;
  readonly maxSteps: number;
  readonly maxArgumentBytes: number;
}

export interface StreamInspectionCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<StreamInspectionLimits>;
}

export function settings(options: StreamInspectionCommandsOptions): StreamInspectionLimits {
  const limits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxRecordBytes: Infinity, maxChunkBytes: Infinity,
    maxFiles: Infinity, maxSteps: Infinity, maxArgumentBytes: Infinity,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) throw new RangeError(`Invalid stream-inspection limit: ${name}`);
  }
  return limits;
}

class InputFailure extends Error {
  constructor(readonly original: unknown) { super("input failed"); }
}

export class Session {
  private inputBytes = 0;
  private outputBytes = 0;
  private steps = 0;
  private untilYield = 4096;
  readonly buffered: ReturnType<typeof createBufferedOutput>;
  private signalAborted = false;
  private readonly pollSignal: boolean;
  private stdin: AsyncIterator<Uint8Array> | undefined;
  private controller = new AbortController();
  readonly signal: AbortSignal;
  failed = false;

  constructor(readonly context: CommandContext, readonly limits: StreamInspectionLimits) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    inheritYieldCheckpoint(context.signal, this.signal);
    this.buffered = createBufferedOutput(context.stdout, this.signal, Math.min(16384, limits.maxChunkBytes));
    this.pollSignal = Object.prototype.hasOwnProperty.call(context.signal, "aborted");
    if (this.signal.aborted) {
      this.signalAborted = true;
    } else if (!this.pollSignal) {
      this.signal.addEventListener("abort", () => { this.signalAborted = true; }, { once: true });
    }
    this.check(context.args.reduce((size, value) => size + utf8ByteLength(value), 0), limits.maxArgumentBytes, "argument");
  }

  check(size: number, maximum: number, label: string): void {
    if (size > maximum) throw new FsError("EFBIG", { message: `stream-inspection ${label} limit exceeded` });
  }

  step(count = 1): void | Promise<void> {
    if (this.signalAborted || (this.pollSignal && this.signal.aborted)) this.signal.throwIfAborted();
    this.steps += count;
    this.check(this.steps, this.limits.maxSteps, "step");
    this.untilYield -= count;
    if (this.untilYield <= 0) {
      this.untilYield = 4096;
      // A work quantum must allow host cancellation even when the clock is frozen.
      return yieldTurn(this.signal).then(() => {
        this.signal.throwIfAborted();
      });
    }
  }

  async output(bytes: Uint8Array): Promise<void> {
    this.check(this.outputBytes + bytes.length, this.limits.maxOutputBytes, "output");
    this.outputBytes += bytes.length;
    const width = Math.min(16384, this.limits.maxChunkBytes);
    for (let offset = 0; offset < bytes.length; offset += width) {
      const step = this.step();
      if (step) await step;
      await this.buffered.write(bytes.subarray(offset, offset + width));
    }
  }

  names(operands: readonly string[]): readonly string[] {
    const names = operands.length ? operands : ["-"];
    this.check(names.length, this.limits.maxFiles, "file");
    return names;
  }

  private async *read(name: string): ByteSource {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    let reader: AsyncGenerator<Uint8Array> | undefined;
    try {

      const source = (async function* (this: Session): ByteSource {
        if (name === "-") {
          this.stdin ??= this.context.stdin[Symbol.asyncIterator]();
          const cursor = this.stdin;
          yield* { [Symbol.asyncIterator]() { return { next: () => cursor.next() }; } };
        } else {
          if (!name) throw new FsError("ENOENT", { path: name });
          const path = pathOf(this.context, name);
          const stat = await this.context.fs.stat(path, { signal });
          signal.throwIfAborted();
          if (stat.type === "directory") throw new FsError("EISDIR", { path });
          await this.step();
          yield* readFileStream(this.context.fs, path, { signal, chunkSize: Math.min(65536, this.limits.maxChunkBytes) });
        }
      }).call(this);
      reader = readBytes(source, signal);
      while (true) {
        await this.step();
        let item: IteratorResult<Uint8Array>;
        await this.buffered.flush();
        try { item = await reader.next(); }
        catch (error) { this.signal.throwIfAborted(); throw new InputFailure(error); }
        if (item.done) break;
        this.check(item.value.length, this.limits.maxChunkBytes, "chunk");
        this.inputBytes += item.value.length;
        this.check(this.inputBytes, this.limits.maxInputBytes, "input");
        yield item.value;
      }
    } finally {
      controller.abort(new FsError("EPIPE", { message: "stream-inspection input transfer ended" }));
      if (reader) await reader.return(undefined).catch(() => {});
    }
  }

  async files(names: readonly string[], process: (source: ByteSource, name: string) => Promise<void>): Promise<void> {
    for (const name of names) {
      try { await process(this.read(name), name); }
      catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof InputFailure)) throw error;
        await diagnostic(this.context, error.original);
        this.failed = true;
      }
    }
  }

  async close(): Promise<void> {
    this.controller.abort(new FsError("EPIPE", { message: "stream-inspection command ended" }));
    if (this.stdin?.return) {
      const cleanup = Promise.resolve().then(() => this.stdin!.return!());
      void cleanup.catch(() => {});
    }
  }
}

export function command(name: string, limits: StreamInspectionLimits, run: (session: Session) => Promise<void>): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    let session: Session | undefined;
    try {
      const infoPromise = gnuInformation(name, context);
      if (infoPromise) {
        const info = await infoPromise;
        if (info) return info;
      }
      session = new Session(context, limits);
      try { await run(session); }
      finally { if (!session.signal.aborted) await session.buffered.flush(); }
      context.signal.throwIfAborted();
      return { exitCode: session.failed ? 1 : 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      await diagnostic(context, error);
      return { exitCode: 1 };
    } finally { await session?.close(); }
  } };
}

export class ByteOutput {
  private bytes: Uint8Array;
  private size = 0;
  constructor(readonly session: Session) { this.bytes = new Uint8Array(Math.min(16384, session.limits.maxChunkBytes)); }
  byte(value: number): void | Promise<void> {
    this.bytes[this.size++] = value;
    if (this.size === this.bytes.length) return this.flush();
  }
  async flush(): Promise<void> {
    if (this.size) await this.session.output(this.bytes.subarray(0, this.size));
    this.size = 0;
  }
}

export class RecordBuffer {
  private bytes: Uint8Array;
  size = 0;
  constructor(readonly session: Session) { this.bytes = new Uint8Array(Math.min(1024, session.limits.maxRecordBytes)); }
  push(byte: number): void {
    this.session.check(this.size + 1, this.session.limits.maxRecordBytes, "record");
    if (this.size === this.bytes.length) {
      const grown = new Uint8Array(Math.min(this.bytes.length * 2, this.session.limits.maxRecordBytes));
      grown.set(this.bytes); this.bytes = grown;
    }
    this.bytes[this.size++] = byte;
  }
  view(): Uint8Array { return this.bytes.subarray(0, this.size); }
  drop(count: number): void { this.bytes.copyWithin(0, count, this.size); this.size -= count; }
  clear(): void { this.size = 0; }
}
