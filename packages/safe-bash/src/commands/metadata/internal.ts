import { yieldTurn } from "../../contracts/yield.js";
import { FsError, writeBytes, type CommandContext, type CommandDefinition, type CommandHandler } from "../../contracts/index.js";
import { diagnostic } from "../internal.js";

export interface MetadataLimits {
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly maxOutputBytes: number;
  readonly maxArgumentBytes: number;
  readonly maxAttempts: number;
}

export interface MetadataCommandsOptions {
  readonly replace?: boolean;
  readonly umask?: number;
  readonly limits?: Partial<MetadataLimits>;
}

export function settings(options: MetadataCommandsOptions = {}) {
  const limits: MetadataLimits = { maxEntries: 100_000, maxDepth: 128, maxOutputBytes: 1024 * 1024, maxArgumentBytes: 64 * 1024, maxAttempts: 128, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (key === "maxDepth" ? 0 : 1)) throw new RangeError(`Invalid metadata limit: ${key}`);
  }
  const umask = options.umask ?? 0o022;
  if (!Number.isInteger(umask) || umask < 0 || umask > 0o777) throw new RangeError("Invalid metadata umask");
  return { limits, umask };
}

export class MetadataBudget {
  private entries = 0;
  private outputBytes = 0;
  constructor(readonly context: CommandContext, readonly limits: MetadataLimits) {
    if (context.args.reduce((size, argument) => size + Buffer.byteLength(argument), 0) > limits.maxArgumentBytes) throw new FsError("EFBIG", { message: "metadata argument limit exceeded" });
  }
  async step(depth = 0): Promise<void> {
    this.context.signal.throwIfAborted();
    if (++this.entries > this.limits.maxEntries || depth > this.limits.maxDepth) throw new FsError("EFBIG", { message: "metadata traversal limit exceeded" });
    if (this.entries % 128 === 0) await yieldTurn();
    this.context.signal.throwIfAborted();
  }
  async output(text: string | Uint8Array): Promise<void> {
    const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
    if (bytes.byteLength > this.limits.maxOutputBytes - this.outputBytes) throw new FsError("EFBIG", { message: "metadata output limit exceeded" });
    this.outputBytes += bytes.byteLength;
    await writeBytes(this.context.stdout, bytes, this.context.signal);
  }
}

export function metadataCommand(name: string, handler: CommandHandler): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    try { return await handler(context); }
    catch (error) { context.signal.throwIfAborted(); await diagnostic(context, error); return { exitCode: 1 }; }
  } };
}

export function permissionString(mode: number, type: "file" | "directory" | "symlink"): string {
  let text = type === "directory" ? "d" : type === "symlink" ? "l" : "-";
  for (const [read, write, execute, special, lower, upper] of [
    [0o400, 0o200, 0o100, 0o4000, "s", "S"],
    [0o040, 0o020, 0o010, 0o2000, "s", "S"],
    [0o004, 0o002, 0o001, 0o1000, "t", "T"],
  ] as const) {
    text += mode & read ? "r" : "-";
    text += mode & write ? "w" : "-";
    text += mode & special ? (mode & execute ? lower : upper) : mode & execute ? "x" : "-";
  }
  return text;
}
