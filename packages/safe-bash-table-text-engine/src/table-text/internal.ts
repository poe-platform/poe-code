import { readFileStream } from "safe-bash-contracts/filesystem";
import { utf8ByteLength, concatBytes } from "safe-bash-byte-engine";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler } from "safe-bash-contracts";
import { diagnostic, pathOf } from "safe-bash-io-engine/internal";
import { gnuInformation } from "safe-bash-io-engine/gnu-information";

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

export function command(name: string, limits: TableTextLimits, handler: (context: CommandContext, budget: Budget) => ReturnType<CommandHandler>): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    let budget: Budget | undefined;
    try {
      const infoPromise = gnuInformation(name, context);
      if (infoPromise) {
        const info = await infoPromise;
        if (info) return info;
      }
      budget = new Budget(context, limits);
      const result = await handler(context, budget);
      await budget.flushOutput();
      return result;
    }
    catch (error) {
      context.signal.throwIfAborted();
      if (budget?.hasPendingOutput()) await budget.flushOutput();
      await diagnostic(context, error);
      return { exitCode: 1 };
    }
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
  steps = 0;
  constructor(readonly context: CommandContext, readonly limits: TableTextLimits, outputChunkBytes = 16384) {
    this.outBuf = new Uint8Array(outputChunkBytes);
    this.check(context.args.reduce((size, value) => size + utf8ByteLength(value), 0), limits.maxArgumentBytes, "argument");
  }
  check(value: number | bigint, maximum: number, label: string): void {
    if (value > maximum) throw new FsError("EFBIG", { message: `table-text ${label} limit exceeded` });
  }
  step(): void | Promise<void> {
    this.context.signal.throwIfAborted();
    this.check(++this.steps, this.limits.maxSteps, "step");
    if (this.steps % 1024 !== 0) return;
    // A work quantum must allow host cancellation even when the clock is frozen.
    return yieldTurn(this.context.signal).then(() => {
      this.context.signal.throwIfAborted();
    });
  }
  input(size: number): void {
    this.check(size, this.limits.maxChunkBytes, "chunk");
    this.inputBytes += size;
    this.context.inputBudget?.check(this.inputBytes);
    this.check(this.inputBytes, this.limits.maxInputBytes, "input");
  }
  admitOutput(size: bigint): void {
    this.check(BigInt(this.outputBytes) + size, this.limits.maxOutputBytes, "output");
  }
  private outBuf: Uint8Array;
  private outUsed = 0;
  private firstFlushed = false;
  hasPendingOutput(): boolean { return this.outUsed > 0; }
  async flushOutput(): Promise<void> {
    if (this.outUsed === 0) return;
    this.firstFlushed = true;
    const slice = this.outBuf.slice(0, this.outUsed);
    this.outUsed = 0;
    await writeBytes(this.context.stdout, slice, this.context.signal);
  }
  output(parts: readonly Uint8Array[]): void | Promise<void> {
    const step = this.step();
    let totalLen = 0;
    for (let i = 0; i < parts.length; i++) {
      totalLen += parts[i]!.length;
    }
    this.outputBytes += totalLen;
    this.check(this.outputBytes, this.limits.maxOutputBytes, "output");
    if (!step && totalLen === 0) return;
    if (!step && this.firstFlushed && this.outUsed + totalLen <= this.outBuf.length) {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.length) {
          this.outBuf.set(part, this.outUsed);
          this.outUsed += part.length;
        }
      }
      return;
    }
    return this.outputSlow(parts, totalLen, step);
  }
  private async outputSlow(parts: readonly Uint8Array[], totalLen: number, step: void | Promise<void>): Promise<void> {
    if (step) await step;
    if (totalLen === 0) return;
    if (!this.firstFlushed) {
      this.firstFlushed = true;
      if (totalLen <= this.outBuf.length) {
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
      return;
    }
    if (this.outUsed + totalLen > this.outBuf.length) {
      await this.flushOutput();
    }
    if (totalLen <= this.outBuf.length) {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.length) {
          this.outBuf.set(part, this.outUsed);
          this.outUsed += part.length;
        }
      }
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
  next(): Uint8Array | undefined | Promise<Uint8Array | undefined> {
    if (!this.done && this.offset < this.chunk.length) {
      const end = this.chunk.indexOf(this.separator, this.offset);
      if (end >= 0) {
        const step = this.budget.step();
        if (!step) {
          const fragment = this.chunk.subarray(this.offset, end);
          this.budget.check(fragment.length, this.budget.limits.maxRecordBytes, "record");
          this.offset = end + 1;
          return fragment;
        }
        return this.nextSlow(step);
      }
    }
    return this.nextSlow();
  }
  private async nextSlow(firstStep?: Promise<void>): Promise<Uint8Array | undefined> {
    if (firstStep) await firstStep;
    let parts: Uint8Array[] | undefined;
    let size = 0;
    let skipFirstStep = Boolean(firstStep);
    while (!this.done) {
      if (skipFirstStep) {
        skipFirstStep = false;
      } else {
        const step = this.budget.step();
        if (step) await step;
      }
      if (this.offset === this.chunk.length) {
        if (this.budget.hasPendingOutput()) await this.budget.flushOutput();
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
        return concatBytes(parts, size);
      }
      if (fragment.length) (parts ??= []).push(fragment);
    }
    if (!size || !parts) return undefined;
    return parts.length === 1 ? parts[0]! : concatBytes(parts, size);
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
      source = readFileStream(this.context.fs, path, { signal: this.signal, chunkSize: Math.min(65536, this.budget.limits.maxChunkBytes) });
    }
    const reader = new RecordReader(source, this.separator, this.budget, this.signal);
    this.readers.push(reader);
    if (name === "-") this.stdin = reader;
    return reader;
  }
  async close(): Promise<void> {
    let flushError: unknown;
    if (!this.signal.aborted && this.budget.hasPendingOutput()) {
      try { await this.budget.flushOutput(); } catch (err) { flushError = err; }
    }
    this.controller.abort(new FsError("EPIPE", { message: "table-text input transfer ended" }));
    if (flushError) { await Promise.all(this.readers.map(reader => reader.close())); throw flushError; }
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
  private unpaired = false;
  failed = false;
  private warned = new Set<number>();
  // Only the transition into each current row matters when default checking starts.
  private pending = new Set<number>();
  constructor(readonly mode: OrderMode, readonly context: CommandContext, readonly budget: Budget) {}
  async markUnpaired(): Promise<void> {
    if (this.unpaired) return;
    this.unpaired = true;
    for (const file of this.pending) await this.report(file);
    this.pending.clear();
  }
  check(previous: Uint8Array | undefined, next: Uint8Array | undefined, file: number, fold = false): void | Promise<void> {
    if (this.mode === "none" || this.warned.has(file)) return;
    const disordered = previous !== undefined && next !== undefined && compare(previous, next, fold) > 0;
    if (this.mode === "default" && !this.unpaired) {
      if (disordered) this.pending.add(file);
      else this.pending.delete(file);
      return;
    }
    if (disordered) return this.report(file);
  }
  private async report(file: number): Promise<void> {
    const message = `file ${file} is not in sorted order`;
    if (this.mode === "check") fail(message);
    this.warned.add(file); this.failed = true;
    if (this.budget.hasPendingOutput()) await this.budget.flushOutput();
    await diagnostic(this.context, new PublicDiagnostic(message));
  }
  async finish(): Promise<void> {
    if (this.failed) {
      if (this.budget.hasPendingOutput()) await this.budget.flushOutput();
      await diagnostic(this.context, new PublicDiagnostic("input is not in sorted order"));
    }
  }
}
