import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface TsortLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxTokenBytes: number;
  readonly maxTokens: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxBufferedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
}

export interface TsortCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<TsortLimits>;
}

export function settings(options: TsortCommandsOptions): TsortLimits {
  const limits: TsortLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxInputBytes: 33_554_432,
    maxTokenBytes: 1_048_576, maxTokens: 2_097_152, maxNodes: 131_072,
    maxEdges: 1_048_576, maxBufferedBytes: 33_554_432, maxOutputBytes: 67_108_864,
    maxDiagnosticBytes: 65_536, maxWork: 134_217_728, maxEmptyChunks: 4096, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid tsort limit: ${name}`);
  }
  return Object.freeze(limits);
}

export class TsortError extends PublicDiagnostic {
  constructor(message: string, readonly usage = false) { super(message); }
}

export function raw(value: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < value.length; offset += 4096) result += String.fromCharCode(...value.subarray(offset, offset + 4096));
  return result;
}

export function bytes(value: string): Uint8Array {
  return Uint8Array.from(value, character => character.charCodeAt(0));
}

export function pathText(value: string): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes(value)); }
  catch { throw new TsortError("filesystem paths must be valid UTF-8"); }
}

export function quote(value: string): string {
  const escapes: Readonly<Record<string, string>> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\\": "\\\\", "'": "\\'" };
  let result = "'";
  for (const character of value) {
    const code = character.charCodeAt(0);
    result += escapes[character] ?? (code >= 32 && code < 127 ? character : `\\${code.toString(8).padStart(3, "0")}`);
  }
  return `${result}'`;
}

export function fileQuote(value: string): string {
  let safe = value.length > 0;
  let escaped = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (!(character >= "a" && character <= "z" || character >= "A" && character <= "Z" || character >= "0" && character <= "9" || "_./-".includes(character))) safe = false;
    if (code < 32 || code >= 127) escaped = true;
  }
  if (safe) return value;
  if (!escaped) {
    if (value.includes("'") && !["$", "`", "\\", '"'].some(character => value.includes(character))) return `"${value}"`;
    return `'${value.split("'").join("'\\''")}'`;
  }
  const escapes: Readonly<Record<string, string>> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v" };
  let result = "'", inEscape = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code >= 127) {
      if (!inEscape) { result += "'$'"; inEscape = true; }
      result += escapes[character] ?? `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      if (inEscape) { result += "''"; inEscape = false; }
      result += character === "'" ? "'\\''" : character;
    }
  }
  return `${result}'`;
}

export class Budget {
  private work = 0;
  private checkpoint = 0;
  private retained = 0;
  private input = 0;
  private output = 0;
  private diagnostics = 0;
  constructor(readonly context: CommandContext, readonly limits: TsortLimits, readonly signal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TsortError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.signal.throwIfAborted();
    this.check(this.work + amount, this.limits.maxWork, "work");
    this.work += amount;
  }
  async checkpointWork(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.work - this.checkpoint >= 4096) { this.checkpoint = this.work; await yieldTurn(this.signal); }
  }
  retain(amount: number): void {
    this.check(this.retained + amount, this.limits.maxBufferedBytes, "buffered bytes");
    this.retained += amount;
  }
  inputBytes(amount: number): void {
    this.check(this.input + amount, this.limits.maxInputBytes, "input bytes");
    this.input += amount;
  }
  emitted(amount: number, diagnostic: boolean): void {
    if (diagnostic) {
      this.check(this.diagnostics + amount, this.limits.maxDiagnosticBytes, "diagnostic bytes");
      this.diagnostics += amount;
    } else {
      this.check(this.output + amount, this.limits.maxOutputBytes, "output bytes");
      this.output += amount;
      this.charge(amount);
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
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TsortError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TsortError("arguments must contain well-formed Unicode");
      }
    }
    total = 0;
    const values = this.context.argumentValues === undefined ? this.context.args : getCommandArguments(this.context).values;
    for (const argument of values) {
      total += shellValueByteLength(argument);
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
    }
    this.charge(total);
    this.retain(total * 8 + this.context.args.length * 64 + 128);
    total = 0;
    return getCommandArguments(this.context).values.map(argument => {
      total += shellValueByteLength(argument);
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      this.charge(shellValueByteLength(argument));
      const value = shellValueBytes(argument);
      if (value.includes(0)) throw new TsortError("NUL is not supported in arguments");
      return raw(value);
    });
  }
}
