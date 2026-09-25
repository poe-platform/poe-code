import { utf8ByteLength, concatBytes } from "safe-bash-contracts/bytes";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, isAbsolutePath, validatePath } from "safe-bash-contracts";

function pathOf(context: Pick<CommandContext, "cwd">, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  validatePath(path);
  validatePath(context.cwd);
  if (!isAbsolutePath(context.cwd)) throw new FsError("EINVAL", { path: context.cwd, message: "cwd must be absolute" });
  return isAbsolutePath(path) ? path : `${context.cwd.endsWith("/") ? context.cwd.slice(0, -1) : context.cwd}/${path}`;
}

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

export class Budget {
  private inputBytes = 0;
  private outputBytes = 0;
  private steps = 0;
  constructor(readonly context: CommandContext, readonly limits: TableTextLimits) {
    this.check(context.args.reduce((size, value) => size + utf8ByteLength(value), 0), limits.maxArgumentBytes, "argument");
  }
  check(value: number | bigint, maximum: number, label: string): void {
    if (value > maximum) throw new FsError("EFBIG", { message: `table-text ${label} limit exceeded` });
  }
  async step(): Promise<void> {
    this.context.signal.throwIfAborted();
    this.check(++this.steps, this.limits.maxSteps, "step");
    if (this.steps % 128 === 0) await yieldTurn();
    this.context.signal.throwIfAborted();
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
      if (end >= 0) return concatBytes(parts, size);
    }
    return size ? concatBytes(parts, size) : undefined;
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

