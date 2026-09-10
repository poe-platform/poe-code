import { FsError, getCommandArguments, writeBytes, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";
import type { RegexExecutionOptions } from "../regex-execution/portable.js";
import type { BoundedRegexProvider } from "../regex-execution/provider.js";
import { exprMatchCeilings } from "../regex-execution/protocol.js";
import { quoteBytes } from "./quoting.js";

export interface CsplitLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxPatterns: number;
  readonly maxInputBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxLines: number;
  readonly maxLineBytes: number;
  readonly maxFiles: number;
  readonly maxFileAttempts: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxPathBytes: number;
  readonly maxPathDepth: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
  readonly maxRegexPatternBytes: number;
  readonly maxRegexNodes: number;
  readonly maxRegexDepth: number;
  readonly maxRegexStates: number;
  readonly maxRegexAllocatedUnits: number;
}

export interface CsplitCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<CsplitLimits>;
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
}

export class CsplitError extends PublicDiagnostic {
  constructor(message: string, readonly usage = false, readonly preserve = false) { super(message); }
}

export function settings(options: CsplitCommandsOptions): CsplitLimits {
  const limits: CsplitLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxPatterns: 1024,
    maxInputBytes: 33_554_432, maxBufferedBytes: 67_108_864, maxLines: 262_144,
    maxLineBytes: 1_048_576, maxFiles: 4096, maxFileAttempts: 8192,
    maxOutputBytes: 33_554_432, maxDiagnosticBytes: 65_536,
    maxPathBytes: 4096, maxPathDepth: 128, maxWork: 67_108_864, maxEmptyChunks: 4096,
    maxRegexPatternBytes: 8192, maxRegexNodes: 4096, maxRegexDepth: 64,
    maxRegexStates: 16_384, maxRegexAllocatedUnits: 1_000_000, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid csplit limit: ${name}`);
  }
  if (limits.maxPathDepth > 4090) throw new RangeError("csplit path depth exceeds cleanup ceiling");
  for (const [name, maximum] of [
    ["maxRegexPatternBytes", exprMatchCeilings.maxPatternBytes], ["maxRegexNodes", exprMatchCeilings.maxNodes],
    ["maxRegexDepth", exprMatchCeilings.maxDepth], ["maxRegexStates", exprMatchCeilings.maxStates],
    ["maxRegexAllocatedUnits", exprMatchCeilings.maxAllocatedUnits],
  ] as const) if (limits[name] > maximum) throw new RangeError(`csplit ${name} exceeds regex ceiling`);
  return Object.freeze(limits);
}

export function raw(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

export function bytes(value: string): Uint8Array {
  return Uint8Array.from(value, character => character.charCodeAt(0));
}

export function pathText(value: string): string {
  if (value.includes("\0")) throw new CsplitError("NUL is not supported in paths");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes(value)); }
  catch { throw new CsplitError("filesystem paths must be valid UTF-8"); }
}

export function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class Budget {
  private work = 0;
  private checkpoint = 0;
  private diagnostics = 0;
  private output = 0;
  constructor(readonly context: CommandContext, readonly limits: CsplitLimits) {}
  quote(value: string): string {
    const locale = this.context.env.LC_ALL || this.context.env.LC_CTYPE || this.context.env.LANG || "C";
    this.charge(value.length);
    this.check(value.length * 4 + 6, this.limits.maxDiagnosticBytes, "quoted diagnostic bytes");
    return quoteBytes(value, locale === "C.UTF-8" || locale === "C.utf8");
  }
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new CsplitError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.context.signal.throwIfAborted();
    this.work += amount;
    this.check(this.work, this.limits.maxWork, "work");
  }
  remaining(): number { return this.limits.maxWork - this.work; }
  async checkpointWork(): Promise<void> {
    this.charge();
    if (this.work - this.checkpoint >= 4096) {
      this.checkpoint = this.work;
      await yieldTurn(this.context.signal);
    }
  }
  arguments(): string[] {
    this.check(this.context.args.length, this.limits.maxArguments, "argument count");
    let total = 0;
    for (const argument of this.context.args) {
      total += argument.length;
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      for (let offset = 0; offset < argument.length; offset++) {
        const unit = argument.charCodeAt(offset);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++offset);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CsplitError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new CsplitError("arguments must contain well-formed Unicode");
      }
    }
    const argumentsWithBytes = getCommandArguments(this.context);
    total = 0;
    const result: string[] = [];
    for (const argument of argumentsWithBytes.values) {
      total += shellValueByteLength(argument);
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      const value = shellValueBytes(argument);
      this.charge(value.length);
      if (value.includes(0)) throw new CsplitError("NUL is not supported in arguments");
      result.push(raw(value));
    }
    return result;
  }
  fileBytes(amount: number): void {
    this.output += amount;
    this.check(this.output, this.limits.maxOutputBytes, "output bytes");
    this.charge(amount);
  }
  async print(value: string, stderr = false): Promise<void> {
    this.diagnostics += value.length;
    this.check(this.diagnostics, this.limits.maxDiagnosticBytes, "count and diagnostic bytes");
    await writeBytes(stderr ? this.context.stderr : this.context.stdout, bytes(value), this.context.signal);
  }
}

export function fsDetail(error: FsError): string {
  const details: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EPERM: "Operation not permitted", EIO: "Input/output error", ENOENT: "No such file or directory",
    EISDIR: "Is a directory", ENOTDIR: "Not a directory", ELOOP: "Too many levels of symbolic links", EROFS: "Read-only file system",
    ENOSPC: "No space left on device", ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported", EEXIST: "File exists",
  };
  return details[error.code] ?? error.message;
}
