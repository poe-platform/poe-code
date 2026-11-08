import { FsError, readBytes, resolvePath, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler } from "../../contracts/index.js";
import { diagnostic } from "../internal.js";

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
    maxInputBytes: 256 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024,
    maxRecordBytes: 1024 * 1024, maxChunkBytes: 1024 * 1024,
    maxGroupBytes: 8 * 1024 * 1024, maxGroupRecords: 100_000,
    maxFields: 65_536, maxFiles: 64, maxSteps: 2_000_000, maxArgumentBytes: 65_536,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid table-text limit: ${name}`);
  }
  return limits;
}

export function fail(message: string): never { throw new FsError("EINVAL", { message }); }

export function command(name: string, handler: CommandHandler): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    try { return await handler(context); }
    catch (error) { context.signal.throwIfAborted(); await diagnostic(context, error); return { exitCode: 1 }; }
  } };
}

export function requireCLocale(context: CommandContext): void {
  const locale = context.env.LC_ALL || context.env.LC_COLLATE || context.env.LANG || "C";
  const ctype = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C";
  if (![locale, ctype].every(value => value === "C" || value === "POSIX")) {
    throw new FsError("ENOTSUP", { message: "table ordering supports only the C/POSIX byte locale; set LC_ALL=C" });
  }
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
  check(value: number, maximum: number, label: string): void {
    if (value > maximum) throw new FsError("EFBIG", { message: `table-text ${label} limit exceeded` });
  }
  async step(): Promise<void> {
    this.context.signal.throwIfAborted();
    this.check(++this.steps, this.limits.maxSteps, "step");
    if (this.steps % 128 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    this.context.signal.throwIfAborted();
  }
  input(size: number): void {
    this.check(size, this.limits.maxChunkBytes, "chunk");
    this.inputBytes += size;
    this.check(this.inputBytes, this.limits.maxInputBytes, "input");
  }
  async output(parts: readonly Uint8Array[]): Promise<void> {
    await this.step();
    this.outputBytes += parts.reduce((size, part) => size + part.length, 0);
    this.check(this.outputBytes, this.limits.maxOutputBytes, "output");
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
    const parts: Uint8Array[] = [];
    let size = 0;
    while (!this.done) {
      await this.budget.step();
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
      if (fragment.length) parts.push(fragment);
      this.offset = stop + (end < 0 ? 0 : 1);
      if (end >= 0) return Buffer.concat(parts, size);
    }
    return size ? Buffer.concat(parts, size) : undefined;
  }
  async closeOperand(name: string): Promise<void> {
    this.budget.context.signal.throwIfAborted();
    if (this.closed) throw new Error(`${name}: Bad file descriptor`);
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
      const path = resolvePath(this.context.cwd, name);
      const stat = await this.context.fs.stat(path, { signal: this.signal });
      if (stat.type === "directory") throw new FsError("EISDIR", { path });
      if (this.context.fs.readStream) source = this.context.fs.readStream(path, { signal: this.signal });
      else {
        const { context, signal, budget } = this;
        source = (async function* () {
          yield await context.fs.readFile(path, { signal, maxBytes: budget.limits.maxChunkBytes });
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
  async check(previous: Uint8Array | undefined, next: Uint8Array | undefined, file: number, fold = false): Promise<void> {
    if (this.mode === "none" || (this.mode === "default" && !this.unpaired) || this.warned.has(file)) return;
    if (previous && next && compare(previous, next, fold) > 0) {
      const message = `file ${file} is not in sorted order`;
      if (this.mode === "check") fail(message);
      this.warned.add(file); this.failed = true;
      await diagnostic(this.context, new Error(message));
    }
  }
}
