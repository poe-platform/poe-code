import { hasYieldCheckpoint, monotonicNow, runYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { FsError, getCommandArguments, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { diagnostic, pathOf } from "../internal.js";
import { gnuInformation } from "../gnu-information.js";

export interface StreamFormatLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRecordBytes: number;
  readonly maxChunkBytes: number;
  readonly maxFiles: number;
  readonly maxSteps: number;
  readonly maxArgumentBytes: number;
  readonly maxNumericDigits: number;
}

export interface StreamFormatCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<StreamFormatLimits>;
}

export function settings(options: StreamFormatCommandsOptions): StreamFormatLimits {
  const limits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxRecordBytes: Infinity, maxChunkBytes: Infinity,
    maxFiles: Infinity, maxSteps: Infinity, maxArgumentBytes: Infinity,
    maxNumericDigits: Infinity, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) throw new RangeError(`Invalid stream-format limit: ${name}`);
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
  private yieldCount = 0;
  private lastYieldMs = monotonicNow();
  private signalAborted = false;
  private readonly pollSignal: boolean;
  private stdin: AsyncIterator<Uint8Array> | undefined;
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  failed = false;

  constructor(readonly context: CommandContext, readonly limits: StreamFormatLimits) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    this.pollSignal = Object.prototype.hasOwnProperty.call(context.signal, "aborted");
    if (this.signal.aborted) {
      this.signalAborted = true;
    } else if (!this.pollSignal) {
      this.signal.addEventListener("abort", () => { this.signalAborted = true; }, { once: true });
    }
    this.check(getCommandArguments(context).values.reduce((size, argument) => size + shellValueByteLength(argument), 0), limits.maxArgumentBytes, "argument");
  }

  check(size: number, maximum: number, label: string): void {
    if ((size | 0) === size && size >= 0) {
      if (size <= maximum) return;
      throw new FsError("EFBIG", { message: `stream-format ${label} limit exceeded` });
    }
    if (!Number.isSafeInteger(size) || size > maximum) throw new FsError("EFBIG", { message: `stream-format ${label} limit exceeded` });
  }

  charge(count = 1): void {
    if (this.signalAborted || (this.pollSignal && this.signal.aborted)) this.signal.throwIfAborted();
    this.steps += count;
    this.check(this.steps, this.limits.maxSteps, "step");
    this.untilYield -= count;
  }

  step(count = 1): void | Promise<void> {
    this.charge(count);
    if (this.untilYield <= 0) {
      this.untilYield = 4096;
      const c = ++this.yieldCount;
      if (hasYieldCheckpoint(this.signal)) return runYieldCheckpoint(this.signal);
      const now = monotonicNow();
      if (c === 1 || (c & 15) === 0 || now - this.lastYieldMs >= 4) {
        this.lastYieldMs = now;
        return yieldTurn().then(() => {
          this.signal.throwIfAborted();
        });
      }
    }
  }

  admitOutput(size: number): void {
    this.check(size, Math.min(this.limits.maxOutputBytes - this.outputBytes, (this.context as CommandContext & { remainingOutputBytes?: () => number }).remainingOutputBytes?.() ?? Infinity), "output");
  }

  async output(bytes: Uint8Array): Promise<void> {
    this.admitOutput(bytes.length);
    this.outputBytes += bytes.length;
    const width = Math.min(16384, this.limits.maxChunkBytes);
    for (let offset = 0; offset < bytes.length; offset += width) {
      const s = this.step();
      if (s) await s;
      const chunk = offset === 0 && bytes.length <= width ? bytes : new Uint8Array(bytes.subarray(offset, offset + width));
      await writeBytes(this.context.stdout, chunk, this.signal);
    }
  }

  async text(text: string): Promise<void> { await this.output(Buffer.from(text)); }

  names(operands: readonly string[]): readonly string[] {
    const names = operands.length ? operands : ["-"];
    this.check(names.length, this.limits.maxFiles, "file");
    return names;
  }

  private async *read(name: string, literalDash = false): ByteSource {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    let reader: AsyncGenerator<Uint8Array> | undefined;
    try {
      const session = this;
      const source = (async function* (): ByteSource {
        if (name === "-" && !literalDash) {
          session.stdin ??= session.context.stdin[Symbol.asyncIterator]();
          const cursor = session.stdin;
          yield* { [Symbol.asyncIterator]() { return { next: () => cursor.next() }; } };
        } else {
          if (!name) throw new FsError("ENOENT", { path: name });
          const path = pathOf(session.context, name);
          const stat = await session.context.fs.stat(path, { signal });
          signal.throwIfAborted();
          if (stat.type === "directory") throw new FsError("EISDIR", { path });
          { const s = session.step(); if (s) await s; }
          const capabilities = await session.context.fs.capabilitiesFor?.(path, { signal }) ?? session.context.fs.capabilities;
          signal.throwIfAborted();
          if (session.context.fs.readStream && capabilities.streamingRead !== false) yield* session.context.fs.readStream(path, { signal });
          else yield await session.context.fs.readFile(path, { signal, ...(Number.isFinite(Math.min(session.limits.maxChunkBytes, session.limits.maxInputBytes - session.inputBytes)) ? { maxBytes: Math.min(session.limits.maxChunkBytes, session.limits.maxInputBytes - session.inputBytes) } : {}) });
        }
      })();
      reader = readBytes(source, signal);
      while (true) {
        { const s = this.step(); if (s) await s; }
        let item: IteratorResult<Uint8Array>;
        try { item = await reader.next(); }
        catch (error) { this.signal.throwIfAborted(); throw new InputFailure(error); }
        if (item.done) break;
        this.check(item.value.length, this.limits.maxChunkBytes, "chunk");
        this.inputBytes += item.value.length;
        this.check(this.inputBytes, this.limits.maxInputBytes, "input");
        yield item.value;
      }
    } finally {
      controller.abort(new FsError("EPIPE", { message: "stream-format input transfer ended" }));
      if (reader) await reader.return(undefined).catch(() => {});
    }
  }

  async files(names: readonly string[], process: (source: ByteSource, name: string) => Promise<void>, literalDash = false): Promise<void> {
    for (const name of names) {
      try { await process(this.read(name, literalDash), name); }
      catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof InputFailure)) throw error;
        await diagnostic(this.context, error.original);
        this.failed = true;
      }
    }
  }

  async close(): Promise<void> {
    this.controller.abort(new FsError("EPIPE", { message: "stream-format command ended" }));
    if (this.stdin?.return) {
      const cleanup = Promise.resolve().then(() => this.stdin!.return!());
      void cleanup.catch(() => {});
    }
  }
}

export function command(name: string, limits: StreamFormatLimits, run: (session: Session) => Promise<void>): CommandDefinition {
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
      await run(session);
      context.signal.throwIfAborted();
      return { exitCode: session.failed ? 1 : 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      await diagnostic(context, error);
      return { exitCode: 1 };
    } finally { await session?.close(); }
  } };
}

export async function* records(source: ByteSource, session: Session, onChunkEnd?: () => Promise<void>): AsyncGenerator<{ bytes: Uint8Array; terminated: boolean }> {
  let buffer = new Uint8Array(Math.min(1024, session.limits.maxRecordBytes));
  let size = 0;
  for await (const chunk of source) {
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf(10, start);
      if (nl >= 0) {
        const segLen = nl - start;
        if (size + segLen > session.limits.maxRecordBytes) {
          const allowed = Math.max(0, session.limits.maxRecordBytes - size);
          const s = session.step(allowed + 1);
          if (s) await s;
          session.check(size + segLen, session.limits.maxRecordBytes, "record");
        }
        const s = session.step(segLen + 1);
        if (s) await s;
        if (size === 0) {
          yield { bytes: chunk.slice(start, nl), terminated: true };
        } else {
          const out = new Uint8Array(size + segLen);
          out.set(buffer.subarray(0, size), 0);
          out.set(chunk.subarray(start, nl), size);
          size = 0;
          yield { bytes: out, terminated: true };
        }
        start = nl + 1;
      } else {
        const segLen = chunk.length - start;
        if (size + segLen > session.limits.maxRecordBytes) {
          const allowed = Math.max(0, session.limits.maxRecordBytes - size);
          const s = session.step(allowed + 1);
          if (s) await s;
          session.check(size + segLen, session.limits.maxRecordBytes, "record");
        }
        const s = session.step(segLen);
        if (s) await s;
        while (size + segLen > buffer.length) {
          const grown = new Uint8Array(Math.min(Math.max(buffer.length * 2, size + segLen), session.limits.maxRecordBytes));
          grown.set(buffer.subarray(0, size));
          buffer = grown;
        }
        buffer.set(chunk.subarray(start), size);
        size += segLen;
        break;
      }
    }
    if (onChunkEnd) await onChunkEnd();
  }
  if (size) yield { bytes: buffer.slice(0, size), terminated: false };
}

export class ByteOutput {
  private readonly bytes: Uint8Array;
  private size = 0;
  constructor(readonly session: Session) { this.bytes = new Uint8Array(Math.min(16384, session.limits.maxChunkBytes)); }
  byte(value: number): void | Promise<void> {
    this.bytes[this.size++] = value;
    if (this.size === this.bytes.length) return this.flush();
  }
  async flush(): Promise<void> {
    if (this.size) {
      this.session.admitOutput(this.size);
      await this.session.output(this.bytes.slice(0, this.size));
    }
    this.size = 0;
  }
}
