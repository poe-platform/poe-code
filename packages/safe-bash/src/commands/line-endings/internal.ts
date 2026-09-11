import { getCommandArguments, type CommandContext, type FileStat } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface LineEndingLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxFiles: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
  readonly maxPathBytes: number;
  readonly maxDepth: number;
  readonly maxTempAttempts: number;
  readonly chunkSize: number;
}
export interface LineEndingCommandsOptions { readonly replace?: boolean; readonly limits?: Partial<LineEndingLimits> }
export type Direction = "dos2unix" | "unix2dos";
export interface ConversionOptions {
  keepBom: boolean;
  addBom: boolean;
  keepUtf16: boolean;
  assume: "bytes" | "le" | "be";
  force: boolean;
  quiet: boolean;
  newline: boolean;
  sevenBit: boolean;
  keepDate: boolean;
  newFile: boolean;
}
export function settings(options: LineEndingCommandsOptions): LineEndingLimits {
  const limits: LineEndingLimits = {
    maxArguments: 1024, maxArgumentBytes: 262_144, maxInputBytes: 16_777_216, maxOutputBytes: 33_554_432,
    maxBufferedBytes: 2_097_152, maxDiagnosticBytes: 65_536, maxFiles: 128, maxWork: 134_217_728,
    maxEmptyChunks: 1024, maxPathBytes: 4096, maxDepth: 64, maxTempAttempts: 128, chunkSize: 16_384,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid line-ending limit: ${name}`);
  return Object.freeze(limits);
}
export class LineEndingError extends PublicDiagnostic {
  constructor(message: string, readonly status = 1) { super(message); }
}
export class Budget {
  private work = 0;
  private quantum = 0;
  private memory = 0;
  private input = 0;
  private output = 0;
  private diagnostics = 0;
  private files = 0;
  constructor(readonly context: CommandContext, readonly limits: LineEndingLimits, readonly signal: AbortSignal, private readonly caller: AbortSignal, private readonly admission: { closed: boolean }) {}
  private assertOpen(): void {
    this.signal.throwIfAborted();
    if (this.admission.closed) throw new LineEndingError("command is closed");
  }
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new LineEndingError(`${label} limit exceeded`);
  }
  retain(amount: number): void { this.check(this.memory + amount, this.limits.maxBufferedBytes, "buffered bytes"); this.memory += amount; }
  incoming(amount: number): void { this.check(this.input + amount, this.limits.maxInputBytes, "input bytes"); this.input += amount; }
  emitted(amount: number, diagnostic = false): void {
    if (diagnostic) { this.check(this.diagnostics + amount, this.limits.maxDiagnosticBytes, "diagnostic bytes"); this.diagnostics += amount; }
    else { this.check(this.output + amount, this.limits.maxOutputBytes, "output bytes"); this.output += amount; }
  }
  file(): void { this.check(++this.files, this.limits.maxFiles, "file count"); }
  async step(amount = 1): Promise<void> {
    this.assertOpen();
    this.check(this.work + amount, this.limits.maxWork, "work"); this.work += amount;
    this.quantum += amount;
    if (this.quantum >= 1024) { this.quantum = 0; await yieldTurn(this.caller); this.assertOpen(); }
  }
  async arguments(): Promise<string[]> {
    const args = this.context.args;
    this.assertOpen();
    const count = args.length;
    this.assertOpen();
    this.check(count, this.limits.maxArguments, "argument count");
    const argumentValues = this.context.argumentValues;
    this.assertOpen();
    const carrier = argumentValues === undefined ? undefined : getCommandArguments({ args, argumentValues });
    const snapshot: string[] = [];
    this.retain(count * 64);
    let total = 0;
    for (let index = 0; index < count; index++) {
      const argument = args[index]!;
      this.assertOpen();
      if (typeof argument !== "string") throw new LineEndingError("arguments must be strings");
      this.check(argument.length, this.limits.maxPathBytes, "argument bytes");
      total += argument.length;
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      this.retain(argument.length * 12);
      snapshot.push(argument);
    }
    for (const argument of snapshot) {
      for (let index = 0; index < argument.length; index++) {
        await this.step();
        const unit = argument.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++index);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new LineEndingError("arguments must be valid UTF-8 paths");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new LineEndingError("arguments must be valid UTF-8 paths");
      }
    }
    const values = (carrier ?? getCommandArguments({ args: snapshot })).values;
    total = 0;
    for (const value of values) {
      const length = shellValueByteLength(value);
      this.check(length, this.limits.maxPathBytes, "argument bytes");
      total += length; this.check(total, this.limits.maxArgumentBytes, "argument bytes");
    }
    const result: string[] = [];
    for (const value of values) {
      await this.step(shellValueByteLength(value));
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(shellValueBytes(value)); }
      catch { throw new LineEndingError("arguments must be valid UTF-8 paths"); }
      if (text.includes("\0")) throw new LineEndingError("NUL is not supported in paths");
      result.push(text);
    }
    return result;
  }
}
export function sameIdentity(first: FileStat, second: FileStat): boolean {
  return ((typeof first.identityScope === "object" && first.identityScope !== null) || typeof first.identityScope === "symbol")
    && first.identityScope === second.identityScope && Number.isSafeInteger(first.dev) && Number.isSafeInteger(first.ino)
    && first.dev! >= 0 && first.ino! >= 0 && first.dev === second.dev && first.ino === second.ino;
}
export function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
