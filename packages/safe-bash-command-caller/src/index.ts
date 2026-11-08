import { writeText, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

export interface CallerFrame {
  readonly line: number;
  readonly name?: string | undefined;
  readonly file: string;
}
export interface CallerLimits { readonly maxArgumentBytes: number; readonly maxOutputBytes: number }
export interface CallerCommandsOptions {
  readonly frames?: readonly CallerFrame[];
  readonly limits?: Partial<CallerLimits>;
  readonly replace?: boolean;
}

export function createCallerCommand(options: CallerCommandsOptions = {}): CommandDefinition {
  const limits = { maxArgumentBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024, ...options.limits };
  for (const value of Object.values(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError("Invalid caller limit");
  }
  return { name: "caller", async execute(context) {
    const byteLength = (text: string): number => {
      let length = 0;
      for (let offset = 0; offset < text.length; offset++) {
        if (offset % 1024 === 0) context.signal.throwIfAborted();
        const code = text.charCodeAt(offset);
        if (code < 128) length++;
        else if (code < 2048) length += 2;
        else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(offset + 1) >= 0xdc00 && text.charCodeAt(offset + 1) <= 0xdfff) {
          length += 4;
          offset++;
        } else length += 3;
      }
      return length;
    };
    let bytes = 0;
    for (const arg of context.args) {
      context.signal.throwIfAborted();
      bytes += byteLength(arg);
      if (bytes > limits.maxArgumentBytes) throw new RangeError("caller argument limit exceeded");
    }
    const terminated = context.args[0] === "--";
    const operand = context.args[terminated ? 1 : 0];
    const invalid = async (value: string, reason: string) => {
      const suffix = `: ${reason}\ncaller: usage: caller [expr]\n`;
      if (8 + byteLength(value) + byteLength(suffix) > limits.maxOutputBytes) {
        throw new RangeError("caller output limit exceeded");
      }
      await writeText(context.stderr, `caller: ${value}${suffix}`);
      return { exitCode: 2 };
    };
    let index = 0;
    if (operand !== undefined) {
      if (!terminated && operand.startsWith("-") && operand !== "-") {
        return invalid(operand.slice(0, 2), "invalid option");
      }
      const text = operand.trim();
      const negative = text.startsWith("-");
      let offset = negative || text.startsWith("+") ? 1 : 0;
      let value = 0n;
      const maximum = negative ? 9223372036854775808n : 9223372036854775807n;
      if (offset === text.length) return invalid(operand, "invalid number");
      for (; offset < text.length; offset++) {
        if (offset % 1024 === 0) context.signal.throwIfAborted();
        const digit = text.charCodeAt(offset) - 48;
        if (digit < 0 || digit > 9) return invalid(operand, operand.startsWith("0x") ? "invalid hex number"
          : operand[0] === "0" && operand.length > 1 && operand.charCodeAt(1) >= 48 && operand.charCodeAt(1) <= 57 ? "invalid octal number" : "invalid number");
        value = value * 10n + BigInt(digit);
        if (value > maximum) return invalid(operand, "invalid number");
      }
      if (negative && value !== 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return { exitCode: 1 };
      index = Number(value);
    }
    const frame = options.frames?.[index];
    if (!frame || operand !== undefined && frame.name === undefined) return { exitCode: 1 };
    const line = String(frame.line);
    const outputBytes = byteLength(line) + 2 + byteLength(frame.file)
      + (operand === undefined ? 0 : byteLength(frame.name!) + 1);
    if (outputBytes > limits.maxOutputBytes) throw new RangeError("caller output limit exceeded");
    const output = operand === undefined ? `${line} ${frame.file}\n` : `${line} ${frame.name} ${frame.file}\n`;
    await writeText(context.stdout, output);
    return { exitCode: 0 };
  } };
}
export function createCallerCommands(options: CallerCommandsOptions = {}): CommandDefinition[] {
  return [createCallerCommand(options)];
}
export function callerCommands(options: CallerCommandsOptions = {}): VirtualShellPlugin {
  return { name: "caller", setup(host) {
    for (const command of createCallerCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
