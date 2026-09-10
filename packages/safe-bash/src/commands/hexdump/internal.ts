import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface HexdumpLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxFormats: number;
  readonly maxWork: number;
  readonly maxEmptyChunks: number;
}

export interface HexdumpCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<HexdumpLimits>;
}

export function settings(options: HexdumpCommandsOptions): HexdumpLimits {
  const limits: HexdumpLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxInputBytes: 33_554_432,
    maxBufferedBytes: 8_388_608, maxOutputBytes: 134_217_728,
    maxDiagnosticBytes: 65_536, maxFormats: 64, maxWork: 536_870_912,
    maxEmptyChunks: 4096, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid hexdump limit: ${name}`);
  }
  return Object.freeze(limits);
}

export class HexdumpError extends PublicDiagnostic {
  constructor(message: string, readonly bare = false) { super(message); }
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
  catch { throw new HexdumpError("filesystem paths must be valid UTF-8"); }
}

export class Budget {
  private work = 0;
  private checkpoint = 0;
  private retained = 0;
  private input = 0;
  private output = 0;
  private diagnostics = 0;
  constructor(readonly context: CommandContext, readonly limits: HexdumpLimits, readonly signal: AbortSignal, private readonly callerSignal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new HexdumpError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.signal.throwIfAborted();
    this.check(this.work + amount, this.limits.maxWork, "work");
    this.work += amount;
  }
  async checkpointWork(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.work - this.checkpoint >= 4096) {
      this.checkpoint = this.work;
      await yieldTurn(this.callerSignal);
      this.signal.throwIfAborted();
    }
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
      this.charge(amount);
      this.output += amount;
    }
  }
  arguments(): string[] {
    const args = this.context.args;
    this.signal.throwIfAborted();
    const count = args.length;
    this.signal.throwIfAborted();
    this.check(count, this.limits.maxArguments, "argument count");
    const argumentValues = this.context.argumentValues;
    this.signal.throwIfAborted();
    const carrier = argumentValues === undefined ? undefined : getCommandArguments({ args, argumentValues });
    this.retain(count * 64 + 128);
    const snapshot: string[] = [];
    let units = 0, total = 0;
    for (let index = 0; index < count; index++) {
      const argument = args[index]!;
      this.signal.throwIfAborted();
      if (typeof argument !== "string") throw new HexdumpError("arguments must be strings");
      units += argument.length;
      this.check(units, this.limits.maxArgumentBytes, "argument bytes");
      this.charge(argument.length + 1);
      for (let offset = 0; offset < argument.length; offset++) {
        const unit = argument.charCodeAt(offset);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++offset);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new HexdumpError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new HexdumpError("arguments must contain well-formed Unicode");
      }
      const size = shellValueByteLength(carrier ? carrier.values[index]! : argument);
      total += size;
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      this.charge(size);
      this.retain(size * 8);
      snapshot.push(argument);
    }
    return (carrier ?? getCommandArguments({ args: snapshot })).values.map(argument => {
      this.charge(shellValueByteLength(argument));
      const value = shellValueBytes(argument);
      if (value.includes(0)) throw new HexdumpError("NUL is not supported in arguments");
      return raw(value);
    });
  }
}
