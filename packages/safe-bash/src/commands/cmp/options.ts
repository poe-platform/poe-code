export interface CmpLimits {
  readonly maxChunkBytes: number;
  readonly maxFallbackBytes: number;
}

export interface CmpCommandsOptions {
  readonly replace?: boolean;
  readonly comparisonBlockBytes?: number;
  readonly limits?: Partial<CmpLimits>;
}

export const integerMaximum = 9223372036854775807n;

export interface CmpArguments {
  readonly files: readonly [string, string];
  readonly skips: readonly [bigint, bigint];
  readonly count: bigint;
  readonly mode: "first" | "all" | "silent";
  readonly printBytes: boolean;
  readonly information?: "help" | "version";
}

export class UsageError extends Error {}

const escapes = new Map([[7, "a"], [8, "b"], [9, "t"], [10, "n"], [11, "v"], [12, "f"], [13, "r"]]);

export function quote(value: string): string {
  let result = "'";
  for (const byte of new TextEncoder().encode(value)) {
    const escape = escapes.get(byte);
    result += escape ? `\\${escape}` : byte < 32 || byte >= 127 ? `\\${byte.toString(8).padStart(3, "0")}`
      : byte === 39 || byte === 92 ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte);
  }
  return `${result}'`;
}

export function pathQuote(value: string): string {
  if (value && !value.startsWith("~") && !value.startsWith("#") && value !== "{" && value !== "}"
    && Array.from(value).every(character => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-+,:@%]~#{}".includes(character))) return value;
  const bytes = new TextEncoder().encode(value);
  if (bytes.every(byte => byte >= 32 && byte < 127)) {
    if (!value.includes("'")) return `'${value}'`;
    if (!["$", "`", "\\", '"'].some(character => value.includes(character))) return `"${value}"`;
    return `'${value.replaceAll("'", "'\\''")}'`;
  }
  let result = "'", escaped = false;
  for (const byte of bytes) {
    const special = byte < 32 || byte >= 127;
    if (special !== escaped) {
      result += special ? "'$'" : "''";
      escaped = special;
    }
    result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
}

function countValue(text: string, kind: "bytes" | "ignore-initial"): bigint {
  const invalid = (): never => { throw new UsageError(`invalid --${kind} value ${quote(text)}`); };
  let position = 0;
  while (position < text.length && " \t\n\r\v\f".includes(text[position]!)) position++;
  let negative = false;
  if (text[position] === "+" || text[position] === "-") negative = text[position++] === "-";
  let base = 10;
  if (text[position] === "0") {
    base = 8;
    if (text[position + 1]?.toLowerCase() === "x") { base = 16; position += 2; }
  }
  const start = position;
  let value = 0n;
  while (position < text.length) {
    const digit = "0123456789abcdef".indexOf(text[position]!.toLowerCase());
    if (digit < 0 || digit >= base) break;
    value = value * BigInt(base) + BigInt(digit);
    if (value > integerMaximum) value = integerMaximum + 1n;
    position++;
  }
  const suffix = text.slice(position);
  const power = suffix ? "KMGTPEZY".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1 : 0;
  if (position === start && (!power || base !== 10 || negative || start !== 0)) invalid();
  if (position === start) value = 1n;
  if (suffix) {
    if (!power || !["", "B", "D", "iB"].includes(suffix.slice(1))) invalid();
    value *= (suffix.endsWith("B") && !suffix.endsWith("iB") || suffix.endsWith("D") ? 1000n : 1024n) ** BigInt(power);
  }
  if (negative && value !== 0n) invalid();
  return value > integerMaximum ? integerMaximum + 1n : value;
}

const longOptions = [
  ["print-bytes", "b"], ["print-chars", "c"], ["ignore-initial", "i"], ["verbose", "l"],
  ["bytes", "n"], ["silent", "s"], ["quiet", "s"], ["version", "v"], ["help", "help"],
] as const;

export function parseArguments(args: readonly string[], posix: boolean): CmpArguments {
  const operands: string[] = [];
  const skips: [bigint, bigint] = [0n, 0n];
  let count = integerMaximum, mode: CmpArguments["mode"] = "first", printBytes = false, stopped = false;
  const skip = (index: 0 | 1, text: string): void => {
    const parsed = countValue(text, "ignore-initial");
    if (skips[index] < integerMaximum && parsed > skips[index]) skips[index] = parsed;
  };
  const apply = (flag: string, value: string | undefined): void => {
    if (flag === "b" || flag === "c") printBytes = true;
    if (flag === "l" || flag === "s") {
      const selected = flag === "l" ? "all" : "silent";
      if (mode !== "first" && mode !== selected) throw new UsageError("options -l and -s are incompatible");
      mode = selected;
    }
    if (flag === "n") {
      const parsed = countValue(value!, "bytes");
      if (parsed < count) count = parsed;
    }
    if (flag === "i") {
      const delimiter = value!.indexOf(":");
      if (delimiter < 0) {
        skip(0, value!);
        if (skips[0] > skips[1]) skips[1] = skips[0];
      } else {
        try { skip(0, value!.slice(0, delimiter)); }
        catch { throw new UsageError(`invalid --ignore-initial value ${quote(value!)}`); }
        skip(1, value!.slice(delimiter + 1));
      }
    }
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      if (posix) stopped = true;
      continue;
    }
    if (argument === "--") { stopped = true; continue; }
    if (argument.startsWith("--")) {
      const separator = argument.indexOf("=");
      const name = argument.slice(2, separator < 0 ? undefined : separator);
      const exact = longOptions.find(([option]) => option === name);
      const matches = exact ? [exact] : longOptions.filter(([option]) => option.startsWith(name));
      if (!matches.length) throw new UsageError(`unrecognized option '${argument}'`);
      if (matches.length > 1) throw new UsageError(`option '${argument}' is ambiguous; possibilities:${matches.map(([option]) => ` '--${option}'`).join("")}`);
      const flag = matches[0]![1];
      let value = separator < 0 ? undefined : argument.slice(separator + 1);
      if (flag === "i" || flag === "n") {
        if (value === undefined) value = args[++index];
        if (value === undefined) throw new UsageError(`option '${argument}' requires an argument`);
      } else if (value !== undefined) throw new UsageError(`option '--${matches[0]![0]}' doesn't allow an argument`);
      if (flag === "help" || flag === "v") return { files: ["-", "-"], skips, count, mode, printBytes, information: flag === "v" ? "version" : "help" };
      apply(flag, value);
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (!"bci:ln:sv".includes(flag) || flag === ":") throw new UsageError(`invalid option -- '${flag}'`);
        if (flag === "v") return { files: ["-", "-"], skips, count, mode, printBytes, information: "version" };
        let value: string | undefined;
        if (flag === "i" || flag === "n") {
          value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new UsageError(`option requires an argument -- '${flag}'`);
          offset = argument.length;
        }
        apply(flag, value);
      }
    }
  }
  if (!operands.length) throw new UsageError(`missing operand after ${quote(args.at(-1) ?? "cmp")}`);
  if (operands[2] !== undefined) skip(0, operands[2]);
  if (operands[3] !== undefined) skip(1, operands[3]);
  if (operands[4] !== undefined) throw new UsageError(`extra operand ${quote(operands[4])}`);
  return { files: [operands[0]!, operands[1] ?? "-"], skips, count, mode, printBytes };
}

export function limitsFor(options: CmpCommandsOptions): CmpLimits {
  const limits = { maxChunkBytes: 1024 * 1024, maxFallbackBytes: 8 * 1024 * 1024, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`cmp ${name} must be a positive safe integer`);
  }
  return Object.freeze(limits);
}
