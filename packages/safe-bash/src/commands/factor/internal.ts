import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface FactorLimits {
  readonly maxValue: number;
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxTokenBytes: number;
  readonly maxNumbers: number;
  readonly maxBufferedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
}

export interface FactorCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<FactorLimits>;
}

export function settings(options: FactorCommandsOptions): FactorLimits {
  const limits: FactorLimits = {
    maxValue: 4_294_967_295, maxArguments: 4096, maxArgumentBytes: 65_536,
    maxInputBytes: 16_777_216, maxTokenBytes: 65_536, maxNumbers: 65_536,
    maxBufferedBytes: 4_194_304, maxOutputBytes: 16_777_216,
    maxDiagnosticBytes: 65_536, maxWork: 8_388_608, maxEmptyChunks: 4096, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid factor limit: ${name}`);
  }
  if (limits.maxValue > 4_294_967_295) throw new RangeError("factor maxValue cannot exceed 4294967295");
  return Object.freeze(limits);
}

export class FactorError extends PublicDiagnostic {
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

const escapes: Readonly<Record<string, string>> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\\": "\\\\", "'": "\\'" };

export function quote(value: string, budget: Budget, suffixLength: number): string {
  let length = 2;
  for (const character of value) {
    const code = character.charCodeAt(0);
    length += escapes[character]?.length ?? (code >= 32 && code < 127 ? 1 : 4);
  }
  budget.diagnosticRoom(length + suffixLength);
  let result = "'";
  for (const character of value) {
    const code = character.charCodeAt(0);
    result += escapes[character] ?? (code >= 32 && code < 127 ? character : `\\${code.toString(8).padStart(3, "0")}`);
  }
  return `${result}'`;
}

export class Budget {
  private work = 0;
  private checkpoint = 0;
  private retained = 0;
  private input = 0;
  private numbers = 0;
  private output = 0;
  private diagnostics = 0;
  constructor(readonly context: CommandContext, readonly limits: FactorLimits, readonly signal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new FactorError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.signal.throwIfAborted();
    this.check(this.work + amount, this.limits.maxWork, "work");
    this.work += amount;
  }
  async checkpointWork(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.work - this.checkpoint >= 1024) { this.checkpoint = this.work; await yieldTurn(this.signal); }
  }
  retain(amount: number): void {
    this.check(this.retained + amount, this.limits.maxBufferedBytes, "buffered bytes");
    this.retained += amount;
  }
  number(): void { this.check(++this.numbers, this.limits.maxNumbers, "numbers"); this.charge(); }
  inputBytes(amount: number): void {
    this.check(this.input + amount, this.limits.maxInputBytes, "input bytes");
    this.input += amount;
  }
  outputRoom(amount: number): void { this.check(this.output + amount, this.limits.maxOutputBytes, "output bytes"); }
  diagnosticRoom(amount: number): void { this.check(this.diagnostics + amount, this.limits.maxDiagnosticBytes, "diagnostic bytes"); }
  emitted(amount: number, diagnostic: boolean): void {
    if (diagnostic) { this.diagnosticRoom(amount); this.diagnostics += amount; }
    else { this.outputRoom(amount); this.charge(amount); this.output += amount; }
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
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new FactorError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new FactorError("arguments must contain well-formed Unicode");
      }
    }
    total = 0;
    const values = this.context.argumentValues === undefined ? this.context.args : getCommandArguments(this.context).values;
    for (const argument of values) { total += shellValueByteLength(argument); this.check(total, this.limits.maxArgumentBytes, "argument bytes"); }
    this.charge(total);
    this.retain(total * 8 + this.context.args.length * 64 + 128);
    return getCommandArguments(this.context).values.map(argument => {
      const value = shellValueBytes(argument);
      if (value.includes(0)) throw new FactorError("NUL is not supported in arguments");
      return raw(value);
    });
  }
}
