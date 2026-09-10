import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface PrLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxFiles: number;
  readonly maxColumns: number;
  readonly maxPageLines: number;
  readonly maxPageWidth: number;
  readonly maxPages: number;
  readonly maxInputBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxLineBytes: number;
  readonly maxLines: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
}

export interface PrCommandsOptions {
  readonly replace?: boolean;
  readonly clock?: () => number;
  readonly limits?: Partial<PrLimits>;
}

export function settings(options: PrCommandsOptions): PrLimits {
  const limits: PrLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxFiles: 128, maxColumns: 128,
    maxPageLines: 65_536, maxPageWidth: 65_536, maxPages: 65_536,
    maxInputBytes: 33_554_432, maxBufferedBytes: 16_777_216,
    maxLineBytes: 1_048_576, maxLines: 1_048_576, maxOutputBytes: 67_108_864,
    maxDiagnosticBytes: 65_536, maxWork: 134_217_728, maxEmptyChunks: 4096, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid pr limit: ${name}`);
  }
  if (options.clock !== undefined && typeof options.clock !== "function") throw new TypeError("pr clock must be a function");
  return Object.freeze(limits);
}

export class PrError extends PublicDiagnostic {
  constructor(message: string, readonly usage = false) { super(message); }
}

export class PrReadError extends PrError {}

export function raw(value: Uint8Array): string {
  let text = "";
  for (const byte of value) text += String.fromCharCode(byte);
  return text;
}

export function bytes(value: string): Uint8Array {
  return Uint8Array.from(value, character => character.charCodeAt(0));
}

export function pathText(value: string): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes(value)); }
  catch { throw new PrError("filesystem paths must be valid UTF-8"); }
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
  let safe = value.length > 0, escaped = false;
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
  let result = "'", inEscape = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code >= 127) {
      if (!inEscape) { result += "'$'"; inEscape = true; }
      result += quote(character).slice(1, -1);
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
  private lines = 0;
  private pages = 0;
  private output = 0;
  private diagnostics = 0;
  constructor(readonly context: CommandContext, readonly limits: PrLimits, readonly signal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new PrError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.signal.throwIfAborted();
    this.work += amount;
    this.check(this.work, this.limits.maxWork, "work");
  }
  async checkpointWork(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.work - this.checkpoint >= 4096) {
      this.checkpoint = this.work;
      await yieldTurn(this.signal);
    }
  }
  retain(amount: number): void {
    this.check(this.retained + amount, this.limits.maxBufferedBytes, "buffered bytes");
    this.retained += amount;
  }
  admitString(length: number): void {
    this.signal.throwIfAborted();
    this.check(length, this.limits.maxWork - this.work, "work");
    this.check(this.retained + length * 2, this.limits.maxBufferedBytes, "buffered bytes");
  }
  inputBytes(amount: number): void {
    this.input += amount;
    this.check(this.input, this.limits.maxInputBytes, "input bytes");
  }
  line(): void { this.check(++this.lines, this.limits.maxLines, "input lines"); }
  page(): void { this.check(++this.pages, this.limits.maxPages, "pages"); this.charge(); }
  emitted(amount: number, diagnostic: boolean): void {
    if (diagnostic) {
      this.diagnostics += amount;
      this.check(this.diagnostics, this.limits.maxDiagnosticBytes, "diagnostic bytes");
    } else {
      this.output += amount;
      this.check(this.output, this.limits.maxOutputBytes, "output bytes");
    }
    if (!diagnostic) this.charge(amount);
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
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new PrError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new PrError("arguments must contain well-formed Unicode");
      }
    }
    total = 0;
    return getCommandArguments(this.context).values.map(argument => {
      total += shellValueByteLength(argument);
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      const value = shellValueBytes(argument);
      this.charge(value.length);
      if (value.includes(0)) throw new PrError("NUL is not supported in arguments");
      return raw(value);
    });
  }
}
