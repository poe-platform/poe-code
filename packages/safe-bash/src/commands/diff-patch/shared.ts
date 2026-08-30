import { setImmediate } from "node:timers/promises";
import {
  collectBytes, isFsError, readBytes, resolvePath, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition, type FileStat,
} from "../../contracts/index.js";

export interface DiffPatchOptions {
  readonly replace?: boolean;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxLines?: number;
  readonly maxWork?: number;
  readonly maxMatrixCells?: number;
  readonly maxFiles?: number;
  readonly maxHunks?: number;
}

export class ToolError extends Error {
  constructor(message: string, readonly exitCode = 2) { super(message); }
}

export class Budget {
  readonly limits: Required<Omit<DiffPatchOptions, "replace">>;
  private inputBytes = 0;
  private outputBytes = 0;
  private lines = 0;
  private work = 0;
  private nextYield = 4096;
  private files = 0;
  private hunks = 0;

  constructor(readonly context: CommandContext, options: DiffPatchOptions) {
    this.limits = {
      maxInputBytes: options.maxInputBytes ?? 16 * 1024 * 1024,
      maxOutputBytes: options.maxOutputBytes ?? 16 * 1024 * 1024,
      maxLines: options.maxLines ?? 100_000,
      maxWork: options.maxWork ?? 8_000_000,
      maxMatrixCells: options.maxMatrixCells ?? 4_000_000,
      maxFiles: options.maxFiles ?? 1024,
      maxHunks: options.maxHunks ?? 10_000,
    };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new ToolError(`${name} must be a positive safe integer`);
    }
  }

  step(amount = 1): void {
    this.context.signal.throwIfAborted();
    this.work += amount;
    if (this.work > this.limits.maxWork) throw new ToolError("work limit exceeded");
  }

  async checkpoint(): Promise<void> {
    this.context.signal.throwIfAborted();
    if (this.work >= this.nextYield) {
      this.nextYield = this.work + 4096;
      await setImmediate(undefined, { signal: this.context.signal });
    }
  }

  file(): void {
    this.step();
    if (++this.files > this.limits.maxFiles) throw new ToolError("file/entry limit exceeded");
  }

  hunk(): void {
    this.step();
    if (++this.hunks > this.limits.maxHunks) throw new ToolError("hunk limit exceeded");
  }

  text(bytes: Uint8Array): string {
    if (bytes.includes(0)) throw new ToolError("binary input is unsupported (NUL byte)");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ToolError("binary input is unsupported (invalid UTF-8)"); }
  }

  split(text: string): string[] {
    const result: string[] = [];
    let start = 0;
    while (start < text.length) {
      if (++this.lines > this.limits.maxLines) throw new ToolError("line limit exceeded");
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline + 1;
      result.push(text.slice(start, end));
      start = end;
    }
    return result;
  }

  async read(path: string): Promise<string> {
    this.context.signal.throwIfAborted();
    const remaining = this.limits.maxInputBytes - this.inputBytes;
    const bytes = path === "-"
      ? await collectBytes(this.chunks(this.context.stdin), { signal: this.context.signal, maxBytes: remaining })
      : this.context.fs.readStream
        ? await collectBytes(this.chunks(this.context.fs.readStream(path, { signal: this.context.signal })), { signal: this.context.signal, maxBytes: remaining })
        : await host(this.context, () => this.context.fs.readFile(path, { signal: this.context.signal, maxBytes: remaining }));
    this.inputBytes += bytes.byteLength;
    if (this.inputBytes > this.limits.maxInputBytes) throw new ToolError("input byte limit exceeded");
    return this.text(bytes);
  }

  private async *chunks(source: ByteSource): ByteSource {
    for await (const chunk of readBytes(source, this.context.signal)) {
      this.step();
      await this.checkpoint();
      yield chunk;
    }
  }

  output(text: string): void {
    this.outputBytes += Buffer.byteLength(text);
    if (this.outputBytes > this.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
  }

  equal(left: string | undefined, right: string | undefined): boolean {
    this.step(1 + Math.max(left?.length ?? 0, right?.length ?? 0));
    return left === right;
  }
}

export async function host<Result>(context: CommandContext, operation: () => Promise<Result>): Promise<Result> {
  context.signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(context.signal.reason);
    context.signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      context.signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => context.signal.removeEventListener("abort", abort));
  });
}

export async function inspect(budget: Budget, path: string): Promise<FileStat | undefined> {
  const context = budget.context;
  if (path.length > 4096) throw new ToolError("path length limit exceeded");
  const absolute = resolvePath(context.cwd, path);
  const parts = absolute.split("/").filter(Boolean);
  if (absolute.length > 4096 || parts.length > 256) throw new ToolError("path length/depth limit exceeded");
  let current = "";
  for (let index = -1; index < parts.length; index++) {
    budget.step();
    await budget.checkpoint();
    if (index >= 0) current += `/${parts[index]!}`;
    let stat: FileStat;
    try { stat = await host(context, () => context.fs.lstat(current || "/", { signal: context.signal })); }
    catch (error) { if (isFsError(error, "ENOENT")) return undefined; throw error; }
    if (stat.type === "symlink") throw new ToolError(`symlink paths are unsupported: ${current}`);
    if (index < parts.length - 1 && stat.type !== "directory") throw new ToolError(`not a directory: ${current}`);
    if (index === parts.length - 1) return stat;
  }
  return undefined;
}

export function integer(value: string, name: string): number {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new ToolError(`invalid ${name}: ${value}`);
  return Number(value);
}

export function definition(name: string, options: DiffPatchOptions, run: (context: CommandContext, budget: Budget) => Promise<number>): CommandDefinition {
  return {
    name,
    async execute(context) {
      context.signal.throwIfAborted();
      try { return { exitCode: await run(context, new Budget(context, options)) }; }
      catch (error) {
        context.signal.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        await writeBytes(context.stderr, Buffer.from(`${name}: ${message.slice(0, 1000)}${message.length > 1000 ? "…" : ""}\n`), context.signal);
        return { exitCode: error instanceof ToolError ? error.exitCode : 2 };
      }
    },
  };
}
