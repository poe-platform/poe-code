import { PublicDiagnostic } from "../../diagnostics.js";
import { yieldTurn } from "../../contracts/yield.js";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler } from "../../contracts/index.js";
import { diagnostic, pathOf } from "../internal.js";
import { gnuInformation } from "../gnu-information.js";

export interface TableTextLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRecordBytes: number;
  readonly maxChunkBytes: number;
  readonly maxGroupBytes: number;
  readonly maxGroupRecords: number;
  readonly maxFields: number;
  readonly maxFiles: number;
  readonly maxSteps: number;
  readonly maxArgumentBytes: number;
}

export interface TableTextCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<TableTextLimits>;
}

export const empty = new Uint8Array();
export const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

export function settings(options: TableTextCommandsOptions): TableTextLimits {
  const limits: TableTextLimits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxRecordBytes: Infinity, maxChunkBytes: Infinity,
    maxGroupBytes: Infinity, maxGroupRecords: Infinity,
    maxFields: Infinity, maxFiles: Infinity, maxSteps: Infinity, maxArgumentBytes: Infinity,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) throw new RangeError(`Invalid table-text limit: ${name}`);
  }
  return limits;
}

export function fail(message: string): never { throw new FsError("EINVAL", { message }); }

export function command(name: string, handler: CommandHandler): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    try {
      const infoPromise = gnuInformation(name, context);
      if (infoPromise) {
        const info = await infoPromise;
        if (info) return info;
      }
      return await handler(context);
    }
    catch (error) { context.signal.throwIfAborted(); await diagnostic(context, error); return { exitCode: 1 }; }
  } };
}

export function compare(left: Uint8Array, right: Uint8Array, fold = false): number {
  for (let offset = 0; offset < Math.min(left.length, right.length); offset++) {
    let first = left[offset]!, second = right[offset]!;
    if (fold && first >= 65 && first <= 90) first += 32;
    if (fold && second >= 65 && second <= 90) second += 32;
    if (first !== second) return first - second;
  }
  return left.length - right.length;
}

export class Budget {
  private inputBytes = 0;
  private outputBytes = 0;
  private steps = 0;
  constructor(readonly context: CommandContext, readonly limits: TableTextLimits) {
    this.check(context.args.reduce((size, value) => size + Buffer.byteLength(value), 0), limits.maxArgumentBytes, "argument");
  }
  check(value: number | bigint, maximum: number, label: string): void {
    if (value > maximum) throw new FsError("EFBIG", { message: `table-text ${label} limit exceeded` });
  }
  step(): void | Promise<void> {
    this.context.signal.throwIfAborted();
    this.check(++this.steps, this.limits.maxSteps, "step");
    if (this.steps % 1024 !== 0) return;
    return yieldTurn().then(() => {
      this.context.signal.throwIfAborted();
    });
  }
  input(size: number): void {
    this.check(size, this.limits.maxChunkBytes, "chunk");
    this.inputBytes += size;
    this.check(this.inputBytes, this.limits.maxInputBytes, "input");
  }
  admitOutput(size: bigint): void {
    this.check(BigInt(this.outputBytes) + size, this.limits.maxOutputBytes, "output");
  }
  async output(parts: readonly Uint8Array[]): Promise<void> {
    const step = this.step();
    if (step) await step;
    let totalLen = 0;
    let nonEmptyCount = 0;
    let singlePart: Uint8Array | undefined;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.length) {
        totalLen += part.length;
        nonEmptyCount++;
        singlePart = part;
      }
    }
    this.outputBytes += totalLen;
    this.check(this.outputBytes, this.limits.maxOutputBytes, "output");
    if (totalLen === 0) return;
    if (nonEmptyCount === 1) {
      await writeBytes(this.context.stdout, singlePart!, this.context.signal);
      return;
    }
    if (totalLen <= 16384) {
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.length) {
          combined.set(part, offset);
          offset += part.length;
        }
      }
      await writeBytes(this.context.stdout, combined, this.context.signal);
      return;
    }
    for (const part of parts) if (part.length) await writeBytes(this.context.stdout, part, this.context.signal);
  }
}

export class RecordReader {
  private chunk: Uint8Array = empty;
  private offset = 0;
  private done = false;
  private closed = false;
  private iterator: AsyncGenerator<Uint8Array>;
  constructor(source: ByteSource, readonly separator: number, readonly budget: Budget, signal: AbortSignal) {
    this.iterator = readBytes(source, signal);
  }
  async next(): Promise<Uint8Array | undefined> {
    let parts: Uint8Array[] | undefined;
    let size = 0;
    while (!this.done) {
      const step = this.budget.step();
      if (step) await step;
      if (this.offset === this.chunk.length) {
        const result = await this.iterator.next();
        if (result.done) { this.done = true; this.chunk = empty; break; }
        this.budget.input(result.value.length);
        this.chunk = Uint8Array.from(result.value);
        this.offset = 0;
        if (!this.chunk.length) continue;
      }
      const end = this.chunk.indexOf(this.separator, this.offset);
      const stop = end < 0 ? this.chunk.length : end;
      const fragment = this.chunk.subarray(this.offset, stop);
      size += fragment.length;
      this.budget.check(size, this.budget.limits.maxRecordBytes, "record");
      this.offset = stop + (end < 0 ? 0 : 1);
      if (end >= 0) {
        if (!parts) return fragment;
        if (fragment.length) parts.push(fragment);
        return Buffer.concat(parts, size);
      }
      if (fragment.length) (parts ??= []).push(fragment);
    }
    if (!size || !parts) return undefined;
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts, size);
  }
  async closeOperand(name: string): Promise<void> {
    this.budget.context.signal.throwIfAborted();
    if (this.closed) throw new PublicDiagnostic(`${name}: Bad file descriptor`);
    await this.close();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.iterator.return(undefined);
  }
}

export class Inputs {
  private controller = new AbortController();
  private readers: RecordReader[] = [];
  private stdin: RecordReader | undefined;
  readonly signal: AbortSignal;
  constructor(readonly context: CommandContext, readonly budget: Budget, readonly separator: number) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
  }
  async open(name: string): Promise<RecordReader> {
    this.signal.throwIfAborted();
    if (name === "-" && this.stdin) return this.stdin;
    this.budget.check(this.readers.length + 1, this.budget.limits.maxFiles, "file");
    let source: ByteSource;
    if (name === "-") source = this.context.stdin;
    else {
      const path = pathOf(this.context, name);
      const stat = await this.context.fs.stat(path, { signal: this.signal });
      if (stat.type === "directory") throw new FsError("EISDIR", { path });
      const capabilities = await this.context.fs.capabilitiesFor?.(path, { signal: this.signal }) ?? this.context.fs.capabilities;
      if (this.context.fs.readStream && capabilities.streamingRead !== false) source = this.context.fs.readStream(path, { signal: this.signal });
      else {
        const { context, signal, budget } = this;
        source = (async function* () {
          yield await context.fs.readFile(path, { signal, ...(Number.isFinite(budget.limits.maxChunkBytes) ? { maxBytes: budget.limits.maxChunkBytes } : {}) });
        })();
      }
    }
    const reader = new RecordReader(source, this.separator, this.budget, this.signal);
    this.readers.push(reader);
    if (name === "-") this.stdin = reader;
    return reader;
  }
  async close(): Promise<void> {
    this.controller.abort(new FsError("EPIPE", { message: "table-text input transfer ended" }));
    await Promise.all(this.readers.map(reader => reader.close()));
  }
}

export function argument(args: readonly string[], index: number, attached: string | undefined, option: string): [string, number] {
  if (attached !== undefined) return [attached, index];
  const value = args[index + 1];
  if (value === undefined) fail(`option ${option} requires an argument`);
  return [value, index + 1];
}

export type OrderMode = "default" | "check" | "none";

export class OrderCheck {
  unpaired = false;
  failed = false;
  private warned = new Set<number>();
  constructor(readonly mode: OrderMode, readonly context: CommandContext) {}
  check(previous: Uint8Array | undefined, next: Uint8Array | undefined, file: number, fold = false): void | Promise<void> {
    if (this.mode === "none" || (this.mode === "default" && !this.unpaired) || this.warned.has(file)) return;
    if (previous && next && compare(previous, next, fold) > 0) {
      const message = `file ${file} is not in sorted order`;
      if (this.mode === "check") fail(message);
      this.warned.add(file); this.failed = true;
      return diagnostic(this.context, new PublicDiagnostic(message));
    }
  }
  async finish(): Promise<void> {
    if (this.failed) await diagnostic(this.context, new PublicDiagnostic("input is not in sorted order"));
  }
}
