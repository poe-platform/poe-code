import { PublicDiagnostic, publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { yieldTurn } from "../../contracts/yield.js";
import {
  collectBytes, isFsError, readBytes,
  type ByteSource, type CommandContext, type CommandDefinition, type FileStat,
} from "../../contracts/index.js";
import { pathOf } from "../internal.js";

export interface DiffPatchOptions {
  readonly replace?: boolean;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxLines?: number;
  readonly maxWork?: number;
  readonly maxMatrixCells?: number;
  readonly maxFiles?: number;
  readonly maxHunks?: number;
  readonly maxExcludePatterns?: number;
  readonly maxExcludePatternBytes?: number;
}

export class ToolError extends PublicDiagnostic {
  constructor(message: string, readonly exitCode = 2) { super(message); }
}

export class Budget {
  readonly limits: Required<Omit<DiffPatchOptions, "replace">>;
  readonly inspected = new Map<string, FileStat>();
  private inputBytes = 0;
  private outputBytes = 0;
  private lines = 0;
  private work = 0;
  private nextYield = 4096;
  private files = 0;
  private hunks = 0;

  get maxBufferBytes(): number { return this.limits.maxInputBytes; }
  get remainingWork(): number { return this.limits.maxWork - this.work; }
  get remainingFiles(): number { return this.limits.maxFiles - this.files; }

  constructor(readonly context: CommandContext, options: DiffPatchOptions) {
    this.limits = {
      maxInputBytes: options.maxInputBytes ?? Infinity,
      maxOutputBytes: options.maxOutputBytes ?? Infinity,
      maxLines: options.maxLines ?? Infinity,
      maxWork: options.maxWork ?? Infinity,
      maxMatrixCells: options.maxMatrixCells ?? Infinity,
      maxFiles: options.maxFiles ?? Infinity,
      maxHunks: options.maxHunks ?? Infinity,
      maxExcludePatterns: options.maxExcludePatterns ?? Infinity,
      maxExcludePatternBytes: options.maxExcludePatternBytes ?? Infinity,
    };
    for (const [name, value] of Object.entries(options).filter(([name]) => name !== "replace")) {
      if (value !== undefined && value !== Infinity && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) throw new ToolError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  step(amount = 1): void {
    this.context.signal.throwIfAborted();
    this.work += amount;
    if (this.work > this.limits.maxWork) throw new ToolError("work limit exceeded");
  }

  checkpoint(): void | Promise<void> {
    this.context.signal.throwIfAborted();
    if (this.work >= this.nextYield) {
      this.nextYield = this.work + 4096;
      return yieldTurn(this.context.signal);
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

  private static readonly utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  text(bytes: Uint8Array): string {
    if (bytes.includes(0)) throw new ToolError("binary input is unsupported (NUL byte)");
    try { return Budget.utf8Decoder.decode(bytes); }
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

  async read(path: string, encoding: "utf8" | "latin1" = "utf8"): Promise<string> {
    this.context.signal.throwIfAborted();
    const remaining = this.limits.maxInputBytes - this.inputBytes;
    const capabilities = path === "-" ? undefined : await host(this.context, async () =>
      await this.context.fs.capabilitiesFor?.(path, { signal: this.context.signal }) ?? this.context.fs.capabilities);
    const bytes = path === "-"
      ? await collectBytes(this.chunks(this.context.stdin), { signal: this.context.signal, ...(Number.isFinite(remaining) ? { maxBytes: remaining } : {}) })
      : this.context.fs.readStream && capabilities?.streamingRead !== false
        ? await collectBytes(this.chunks(this.context.fs.readStream(path, { signal: this.context.signal })), { signal: this.context.signal, ...(Number.isFinite(remaining) ? { maxBytes: remaining } : {}) })
        : await host(this.context, () => this.context.fs.readFile(path, { signal: this.context.signal, ...(Number.isFinite(remaining) ? { maxBytes: remaining } : {}) }));
    this.inputBytes += bytes.byteLength;
    if (this.inputBytes > this.limits.maxInputBytes) throw new ToolError("input byte limit exceeded");
    return encoding === "latin1" ? Buffer.from(bytes).toString("latin1") : this.text(bytes);
  }

  async readDiff(path: string, encoding: "utf8" | "latin1" = "utf8"): Promise<string> {
    const { fs, signal } = this.context;
    const expected = this.inspected.get(path);
    const verifyAncestors = async () => {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (let index = -1; index < parts.length - 1; index++) {
        if (index >= 0) current += `/${parts[index]!}`;
        const ancestor = current || "/";
        const wanted = this.inspected.get(ancestor);
        const actual = await fs.stat(ancestor, { signal });
        if (!wanted || !sameIdentity(actual, wanted)) throw new ToolError("diff input ancestry changed");
      }
    };
    const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
    if (!expected || !sameIdentity(expected, expected) || capabilities.retainedRead !== true || !fs.openReadFile)
      throw new ToolError("diff input requires identity-checked retained reads");
    await verifyAncestors();
    const handle = await fs.openReadFile(path, { signal });
    try {
      const stat = await handle.stat({ signal });
      if (!sameIdentity(stat, expected) || stat.size !== expected.size || stat.revision !== expected.revision)
        throw new ToolError("diff input changed while opening");
      await verifyAncestors();
      const remaining = this.limits.maxInputBytes - this.inputBytes;
      if (stat.size > remaining) throw new ToolError("input byte limit exceeded");
      const chunks: Uint8Array[] = [];
      let position = 0;
      while (position < stat.size) {
        this.step();
        { const c = this.checkpoint(); if (c) await c; }
        const size = Math.min(65536, stat.size - position);
        const chunk = await handle.read(position, size, { signal });
        if (!chunk.length || chunk.length > size) throw new ToolError("diff input changed while reading");
        chunks.push(chunk);
        position += chunk.length;
      }
      const after = await handle.stat({ signal });
      if (!sameIdentity(after, stat) || after.size !== stat.size || after.revision !== stat.revision)
        throw new ToolError("diff input changed while reading");
      const bytes = Buffer.concat(chunks, position);
      this.inputBytes += position;
      return encoding === "latin1" ? bytes.toString("latin1") : this.text(bytes);
    } finally { await handle.close(); }
  }

  private async *chunks(source: ByteSource): ByteSource {
    for await (const chunk of readBytes(source, this.context.signal)) {
      this.step();
      { const c = this.checkpoint(); if (c) await c; }
      yield chunk;
    }
  }

  output(text: string, encoding: "utf8" | "latin1" = "utf8"): void {
    this.outputBytes += Buffer.byteLength(text, encoding);
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

export function sameIdentity(actual: FileStat, wanted: FileStat): boolean {
  return wanted.identityScope !== undefined && wanted.dev !== undefined && wanted.ino !== undefined
    && actual.identityScope === wanted.identityScope && actual.dev === wanted.dev && actual.ino === wanted.ino
    && actual.type === wanted.type;
}

export async function inspect(budget: Budget, path: string, symlinks: "reject" | "follow" | "compare" = "reject"): Promise<FileStat | undefined> {
  const context = budget.context;
  const absolute = pathOf(context, path);
  const parts = absolute.split("/").filter(Boolean);
  let current = "";
  for (let index = -1; index < parts.length; index++) {
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
    if (index >= 0) current += `/${parts[index]!}`;
    let stat: FileStat;
    try { stat = await host(context, () => context.fs.lstat(current || "/", { signal: context.signal })); }
    catch (error) { if (isFsError(error, "ENOENT")) return undefined; throw error; }
    if (stat.type === "symlink") {
      if (symlinks === "reject") throw new ToolError(`symlink paths are unsupported: ${current}`);
      if (symlinks === "follow" || index < parts.length - 1) stat = await host(context, () => context.fs.stat(current || "/", { signal: context.signal }));
    }
    budget.inspected.set(current || "/", stat);
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
        const message = publicDiagnosticMessage(error, context.onInternalError);
        await writeDiagnostic(context.stderr, `${name}: ${message.slice(0, 1000)}${message.length > 1000 ? "…" : ""}\n`, context.signal);
        return { exitCode: error instanceof ToolError ? error.exitCode : 2 };
      }
    },
  };
}
