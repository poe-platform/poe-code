import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export interface GetoptLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxInputBytes: number;
  readonly maxSchemaBytes: number;
  readonly maxLongOptions: number;
  readonly maxBufferedBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxWork: number;
}

export interface GetoptCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<GetoptLimits>;
}

export function settings(options: GetoptCommandsOptions): GetoptLimits {
  const limits: GetoptLimits = {
    maxArguments: 4096, maxArgumentBytes: 65_536, maxInputBytes: 1_048_576,
    maxSchemaBytes: 65_536, maxLongOptions: 4096, maxBufferedBytes: 4_194_304,
    maxOutputBytes: 8_388_608, maxDiagnosticBytes: 65_536, maxWork: 8_388_608,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid getopt limit: ${name}`);
  }
  return Object.freeze(limits);
}

export class GetoptError extends PublicDiagnostic {
  constructor(message: string, readonly status = 3, readonly usage = false) { super(message); }
}

export class Budget {
  private work = 0;
  private quantum = 0;
  private retained = 0;
  private diagnosticRetained = 0;
  private schemaBytes = 0;
  private output = 0;
  private diagnostics = 0;
  constructor(readonly context: CommandContext, readonly limits: GetoptLimits, readonly signal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new GetoptError(`${label} limit exceeded`);
  }
  async step(amount = 1, diagnostic = false): Promise<void> {
    this.signal.throwIfAborted();
    if (!diagnostic) { this.check(this.work + amount, this.limits.maxWork, "work"); this.work += amount; }
    this.quantum += amount;
    if (this.quantum >= 1024) { this.quantum = 0; await yieldTurn(this.signal); }
  }
  retain(amount: number, diagnostic = false): void {
    if (diagnostic) {
      this.check(this.diagnosticRetained + amount, this.limits.maxDiagnosticBytes, "diagnostic buffered bytes");
      this.diagnosticRetained += amount;
    } else {
      this.check(this.retained + amount, this.limits.maxBufferedBytes, "buffered bytes");
      this.retained += amount;
    }
  }
  schema(amount: number): void {
    this.check(this.schemaBytes + amount, this.limits.maxSchemaBytes, "schema bytes");
    this.schemaBytes += amount;
  }
  room(amount: number, diagnostic = false): void {
    this.check((diagnostic ? this.diagnostics : this.output) + amount,
      diagnostic ? this.limits.maxDiagnosticBytes : this.limits.maxOutputBytes, diagnostic ? "diagnostic bytes" : "output bytes");
  }
  emitted(amount: number, diagnostic: boolean): void {
    this.room(amount, diagnostic);
    if (diagnostic) this.diagnostics += amount;
    else this.output += amount;
  }
  async arguments(): Promise<string[]> {
    const args = this.context.args;
    this.signal.throwIfAborted();
    this.check(args.length, this.limits.maxArguments, "argument count");
    let total = 0;
    for (const argument of args) {
      this.check(argument.length, this.limits.maxArgumentBytes, "argument bytes");
      total += argument.length;
      this.check(total, this.limits.maxInputBytes, "input bytes");
      for (let offset = 0; offset < argument.length; offset++) {
        await this.step();
        const unit = argument.charCodeAt(offset);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++offset);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new GetoptError("arguments must contain well-formed Unicode", 2);
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new GetoptError("arguments must contain well-formed Unicode", 2);
      }
    }
    const values = this.context.argumentValues === undefined ? args : getCommandArguments(this.context).values;
    total = 0;
    for (const argument of values) {
      await this.step();
      const size = shellValueByteLength(argument);
      this.check(size, this.limits.maxArgumentBytes, "argument bytes");
      total += size;
      this.check(total, this.limits.maxInputBytes, "input bytes");
    }
    this.retain(total * 8 + args.length * 64 + 256);
    this.signal.throwIfAborted();
    const owned = getCommandArguments(this.context).values;
    const result: string[] = [];
    for (const argument of owned) {
      await this.step();
      const value = shellValueBytes(argument);
      let text = "";
      for (let offset = 0; offset < value.length; offset += 256) {
        const end = Math.min(offset + 256, value.length);
        for (let index = offset; index < end; index++) {
          await this.step();
          if (value[index] === 0) throw new GetoptError("NUL is not supported in arguments", 2);
        }
        text += String.fromCharCode(...value.subarray(offset, end));
      }
      result.push(text);
    }
    return result;
  }
}
