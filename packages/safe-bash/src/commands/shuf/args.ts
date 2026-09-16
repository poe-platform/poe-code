import { getCommandArguments, type CommandContext } from "../../contracts/index.js";

export const wordMax = (1n << 64n) - 1n;
export const countMax = (1n << 63n) - 1n;
export class Diagnostic extends Error {
  constructor(message: string, readonly bytes?: Uint8Array) { super(message); }
}

export function quote(value: string | Uint8Array): string {
  let result = "'";
  const escapes: Readonly<Record<string, string>> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f", "\v": "\\v", "\u0007": "\\a", "\\": "\\\\", "'": "\\'" };
  for (const code of typeof value === "string" ? Buffer.from(value) : value) {
    const character = String.fromCharCode(code);
    result += escapes[character] ?? (code < 32 || code >= 127 ? `\\${code.toString(8).padStart(3, "0")}` : character);
  }
  return `${result}'`;
}

export function fileQuote(value: string): string {
  if (value && value !== "{" && value !== "}" && !"#~".includes(value[0]!) && Array.from(value).every(character => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_+-./,%#@]{}~".includes(character))) return value;
  if (!value.includes("'") && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127)) return `'${value}'`;
  if (value.includes("'") && !Array.from(value).some(character => "\"\\$`".includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127)) return `"${value}"`;
  let result = "'";
  let escaped = false;
  for (const code of Buffer.from(value)) {
    const character = String.fromCharCode(code);
    const control = code < 32 || code >= 127;
    if (control !== escaped) {
      result += control ? "'$'" : "''";
      escaped = control;
    }
    result += control ? code >= 127 ? `\\${code.toString(8).padStart(3, "0")}` : quote(character).slice(1, -1) : character === "'" ? "'\\''" : character;
  }
  return `${result}'`;
}

function usage(message: string): never {
  throw new Diagnostic(`shuf: ${message}\nTry 'shuf --help' for more information.\n`);
}

function unsigned(value: string, start = 0) {
  let cursor = start;
  while (cursor < value.length && " \t\n\r\v\f".includes(value[cursor]!)) cursor++;
  if (value[cursor] === "+") cursor++;
  const first = cursor;
  let number = 0n;
  while (cursor < value.length && value[cursor]! >= "0" && value[cursor]! <= "9") {
    if (number <= wordMax) number = number * 10n + BigInt(value[cursor]!);
    cursor++;
  }
  return { number, cursor, valid: cursor > first, overflow: number > wordMax };
}

const longOptions = ["echo", "input-range", "head-count", "output", "random-source", "repeat", "zero-terminated", "help", "version"] as const;

export function parse(context: CommandContext) {
  const result = {
    echo: false, repeat: false, delimiter: 10, count: countMax,
    range: undefined as { low: bigint; size: bigint } | undefined,
    output: undefined as string | undefined, random: undefined as string | undefined,
    action: undefined as "help" | "version" | undefined, operands: [] as number[],
  };
  const apply = (option: string, value: string, valueIndex: number, valueOffset: number): void => {
    switch (option) {
      case "e": result.echo = true; break;
      case "r": result.repeat = true; break;
      case "z": result.delimiter = 0; break;
      case "i": {
        if (result.range) throw new Diagnostic("shuf: multiple -i options specified\n");
        const low = unsigned(value);
        const high = unsigned(value, low.cursor + 1);
        const overflow = low.overflow || low.valid && value[low.cursor] === "-" && high.overflow && high.cursor === value.length;
        const size = high.number - low.number + 1n;
        if (!low.valid || !high.valid || value[low.cursor] !== "-" || high.cursor !== value.length || overflow || size < 0n || size > wordMax) {
          throw new Diagnostic(`shuf: invalid input range: ${quote(value)}${overflow ? ": Value too large to be stored in data type" : ""}\n`);
        }
        result.range = { low: low.number, size };
        break;
      }
      case "n": {
        const parsed = unsigned(value);
        if (!parsed.valid || parsed.cursor !== value.length) {
          throw new Diagnostic(`shuf: invalid line count: ${quote(getCommandArguments(context).bytes(valueIndex)!.subarray(valueOffset))}\n`);
        }
        if (!parsed.overflow && parsed.number < result.count) result.count = parsed.number;
        break;
      }
      case "o":
        if (result.output !== undefined && result.output !== value) throw new Diagnostic("shuf: multiple output files specified\n");
        result.output = value;
        break;
      case "random-source":
        if (result.random !== undefined && result.random !== value) throw new Diagnostic("shuf: multiple random sources specified\n");
        result.random = value;
        break;
      case "help": case "version": result.action = option; break;
    }
  };
  let ended = false;
  for (let index = 0; index < context.args.length; index++) {
    context.signal.throwIfAborted();
    const argument = context.args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      result.operands.push(index);
      if (Object.hasOwn(context.env, "POSIXLY_CORRECT")) ended = true;
    } else if (argument === "--") ended = true;
    else if (argument.startsWith("--")) {
      const equal = argument.indexOf("=");
      const name = argument.slice(2, equal < 0 ? undefined : equal);
      const matches = longOptions.includes(name as typeof longOptions[number]) ? [name] : longOptions.filter(option => option.startsWith(name));
      if (!matches.length) usage(`unrecognized option '${argument}'`);
      if (matches.length > 1) usage(`option '${argument}' is ambiguous; possibilities:${matches.map(option => ` '--${option}'`).join("")}`);
      const option = matches[0]!;
      const required = ["input-range", "head-count", "output", "random-source"].includes(option);
      if (!required && equal >= 0) usage(`option '--${option}' doesn't allow an argument`);
      let value = equal < 0 ? "" : argument.slice(equal + 1);
      if (required && equal < 0) {
        if (++index >= context.args.length) usage(`option '--${option}' requires an argument`);
        value = context.args[index]!;
      }
      const short: Record<string, string> = { echo: "e", "input-range": "i", "head-count": "n", output: "o", repeat: "r", "zero-terminated": "z" };
      apply(short[option] ?? option, value, index, equal < 0 ? 0 : equal + 1);
    } else {
      for (let cursor = 1; cursor < argument.length; cursor++) {
        const option = argument[cursor]!;
        if (!"einorz".includes(option)) {
          const byte = getCommandArguments(context).bytes(index)![cursor]!;
          const bytes = Buffer.concat([Buffer.from("shuf: invalid option -- '"), Buffer.from([byte]), Buffer.from("'\nTry 'shuf --help' for more information.\n")]);
          throw new Diagnostic(bytes.toString(), bytes);
        }
        let value = "";
        let valueOffset = cursor + 1;
        if ("ino".includes(option)) {
          value = argument.slice(cursor + 1);
          if (!value) {
            if (++index >= context.args.length) usage(`option requires an argument -- '${option}'`);
            value = context.args[index]!;
            valueOffset = 0;
          }
          cursor = argument.length;
        }
        apply(option, value, index, valueOffset);
      }
    }
    if (result.action) return result;
  }
  if (result.echo && result.range) usage("cannot combine -e and -i options");
  if (result.range ? result.operands.length > 0 : !result.echo && result.operands.length > 1) {
    usage(`extra operand ${quote(context.args[result.operands[result.range ? 0 : 1]!]!)}`);
  }
  return result;
}
