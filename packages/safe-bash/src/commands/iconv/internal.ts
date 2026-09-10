import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface IconvLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWork: number;
  readonly maxChunks: number;
  readonly maxEmptyChunks: number;
}

export interface IconvCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<IconvLimits>;
}

export function settings(options: IconvCommandsOptions): IconvLimits {
  const limits: IconvLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxInputBytes: 8_388_608,
    maxBufferedBytes: 33_554_432, maxOutputBytes: 67_108_864,
    maxDiagnosticBytes: 65_536, maxWork: 134_217_728, maxChunks: 65_536,
    maxEmptyChunks: 4096, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid iconv limit: ${name}`);
  }
  return Object.freeze(limits);
}

export class IconvError extends PublicDiagnostic {
  constructor(message: string, readonly status = 1) { super(message); }
}

export function raw(value: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < value.length; offset += 4096) result += String.fromCharCode(...value.subarray(offset, offset + 4096));
  return result;
}

export function pathText(value: string): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(value, character => character.charCodeAt(0))); }
  catch { throw new IconvError("filesystem paths must be valid UTF-8"); }
}

export class Budget {
  private work = 0;
  private checkpoint = 0;
  private retained = 0;
  private input = 0;
  private output = 0;
  private diagnostics = 0;
  private chunks = 0;
  private empties = 0;
  constructor(readonly context: CommandContext, readonly limits: IconvLimits, readonly signal: AbortSignal, readonly callerSignal: AbortSignal, readonly admission: { readonly closed: boolean }) {}
  assertOpen(): void {
    this.signal.throwIfAborted();
    if (this.admission.closed) throw new IconvError("command is closed");
  }
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new IconvError(`${label} limit exceeded`);
  }
  charge(amount = 1): void {
    this.assertOpen();
    this.check(this.work + amount, this.limits.maxWork, "work"); this.work += amount;
  }
  async checkpointWork(): Promise<void> {
    this.assertOpen();
    if (this.work - this.checkpoint >= 4096) {
      this.checkpoint = this.work;
      await yieldTurn(this.callerSignal);
      this.assertOpen();
    }
  }
  retain(amount: number): void {
    this.check(this.retained + amount, this.limits.maxBufferedBytes, "buffered bytes"); this.retained += amount;
  }
  snapshotMaximum(): number { return Math.min(this.limits.maxInputBytes - this.input, Math.floor((this.limits.maxBufferedBytes - this.retained) / 2)); }
  inputBytes(amount: number): void {
    this.check(this.input + amount, this.limits.maxInputBytes, "input bytes"); this.input += amount;
    this.check(++this.chunks, this.limits.maxChunks, "input chunks");
    if (!amount) this.check(++this.empties, this.limits.maxEmptyChunks, "empty input chunks");
    this.charge(amount + 1);
  }
  emitted(amount: number, diagnostic: boolean): void {
    if (diagnostic) { this.check(this.diagnostics + amount, this.limits.maxDiagnosticBytes, "diagnostic bytes"); this.diagnostics += amount; }
    else { this.check(this.output + amount, this.limits.maxOutputBytes, "output bytes"); this.charge(amount); this.output += amount; }
  }
  arguments(): string[] {
    this.assertOpen();
    const args = this.context.args;
    this.assertOpen();
    const count = args.length;
    this.assertOpen();
    this.check(count, this.limits.maxArguments, "argument count");
    const argumentValues = this.context.argumentValues;
    this.assertOpen();
    const carrier = argumentValues === undefined ? undefined : getCommandArguments({ args, argumentValues });
    this.assertOpen();
    this.retain(count * 64 + 128);
    const snapshot: string[] = [];
    let units = 0, total = 0;
    for (let index = 0; index < count; index++) {
      const argument = args[index]!;
      this.assertOpen();
      if (typeof argument !== "string") throw new IconvError("arguments must be strings");
      units += argument.length;
      this.check(units, this.limits.maxArgumentBytes, "argument bytes");
      this.charge(argument.length + 1);
      for (let offset = 0; offset < argument.length; offset++) {
        const unit = argument.charCodeAt(offset);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++offset);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new IconvError("arguments must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new IconvError("arguments must contain well-formed Unicode");
      }
      const size = shellValueByteLength(carrier ? carrier.values[index]! : argument);
      total += size;
      this.check(total, this.limits.maxArgumentBytes, "argument bytes");
      this.charge(size); this.retain(size * 8);
      snapshot.push(argument);
    }
    return (carrier ?? getCommandArguments({ args: snapshot })).values.map(argument => {
      this.charge(shellValueByteLength(argument));
      const value = shellValueBytes(argument);
      if (value.includes(0)) throw new IconvError("NUL is not supported in arguments");
      return raw(value);
    });
  }
}
