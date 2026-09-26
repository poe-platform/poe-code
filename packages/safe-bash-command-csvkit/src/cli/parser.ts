import { OwnedArguments, type ArgumentLimits } from "../argv.js";
import { commands } from "../commands.js";
import type { ArgumentDescriptor, CommandDescriptor } from "../descriptor.js";
import { commandDefaults } from "../descriptor.js";
import { decimalZeroes, integerWhitespace, nonprintingRanges } from "../unicode-profile.js";
import { MatchFileScope, type MatchFile } from "../match-files.js";
import { CsvkitBlocked } from "../errors.js";

export interface ParserOptions {
  readonly limits: ArgumentLimits;
  /** Eager opening only; line reads occur during the command operation. */
  readonly openMatchFile?: (path: string) => Promise<MatchFile>;
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
  readonly signal?: AbortSignal;
  readonly env?: Readonly<Record<string, string>>;
}
export type ParseResult =
  | { readonly kind: "parsed"; readonly options: Readonly<Record<string, unknown>>; readonly dispose: () => Promise<void>; readonly matchFiles: MatchFileScope }
  | { readonly kind: "exit"; readonly status: 0 | 2; readonly stdout: string; readonly stderr: string };

export function repr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let text = quote;
  for (const char of value) {
    if (char === quote || char === "\\") text += "\\" + char;
    else if (char === "\n") text += "\\n";
    else if (char === "\r") text += "\\r";
    else if (char === "\t") text += "\\t";
    else {
      const codepoint = char.codePointAt(0)!;
      if (nonprintingRanges.some(([start, end]) => codepoint >= start && codepoint <= end)) {
        const width = codepoint <= 255 ? 2 : codepoint <= 65535 ? 4 : 8;
        text += "\\" + (width === 2 ? "x" : width === 4 ? "u" : "U") + codepoint.toString(16).padStart(width, "0");
      } else text += char;
    }
  }
  return text + quote;
}

export function integer(text: string, maxDigits = 4300): number | bigint | undefined {
  const characters = Array.from(text);
  let start = 0;
  let end = characters.length;
  while (start < end && integerWhitespace.includes(characters[start]!.codePointAt(0)!)) start++;
  while (end > start && integerWhitespace.includes(characters[end - 1]!.codePointAt(0)!)) end--;
  const value = characters.slice(start, end).join("");
  let offset = value[0] === "+" || value[0] === "-" ? 1 : 0;
  let digits = "";
  let previousDigit = false;
  const payload = Array.from(value.slice(offset));
  for (offset = 0; offset < payload.length; offset++) {
    const char = payload[offset]!;
    const codepoint = char.codePointAt(0)!;
    const zero = decimalZeroes.find(zero => codepoint >= zero && codepoint <= zero + 9);
    if (zero !== undefined) { digits += String(codepoint - zero); previousDigit = true; }
    else if (char === "_" && previousDigit && offset + 1 < payload.length) previousDigit = false;
    else return undefined;
  }
  // Frozen CPython sys.int_info.default_max_str_digits, including leading zeroes.
  if (!digits || !previousDigit || digits.length > maxDigits) return undefined;
  const big = BigInt((value[0] === "-" ? "-" : "") + digits);
  const number = Number(big);
  return Number.isSafeInteger(number) ? number : big;
}

function negativeNumber(text: string): boolean {
  if (!text.startsWith("-") || text.length === 1) return false;
  // CPython 3.14 argparse matches the prefix -\.?\d, not the entire token.
  const first = Array.from(text.slice(text[1] === "." ? 2 : 1))[0];
  if (first === undefined) return false;
  const point = first.codePointAt(0)!;
  return decimalZeroes.some(zero => point >= zero && point <= zero + 9);
}

/** CPython filesystem decoding retains each invalid UTF-8 byte as U+DC80–U+DCFF. */
function decodeArgument(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!;
    if (first < 0x80) { result += String.fromCharCode(first); index++; continue; }
    const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    let valid = width !== 0 && index + width <= bytes.length;
    let point = first & (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);
    for (let offset = 1; valid && offset < width; offset++) {
      const byte = bytes[index + offset]!;
      valid = byte >= 0x80 && byte <= 0xbf;
      if (offset === 1) {
        if (first === 0xe0 && byte < 0xa0 || first === 0xed && byte >= 0xa0 || first === 0xf0 && byte < 0x90 || first === 0xf4 && byte >= 0x90) valid = false;
      }
      point = (point << 6) | (byte & 0x3f);
    }
    if (valid) { result += String.fromCodePoint(point); index += width; }
    else { result += String.fromCharCode(0xdc00 + first); index++; }
  }
  return result;
}

async function disposeAfterParse(files: MatchFileScope, signal: AbortSignal | undefined, escapingFailure: boolean): Promise<void> {
  try { await files.dispose(); }
  catch (cleanupFailure) {
    signal?.throwIfAborted();
    if (!escapingFailure) throw cleanupFailure;
  }
  signal?.throwIfAborted();
}

/** Parser profile: CPython 3.14.2, C locale, 80 columns, UTF-8/surrogateescape argv. */
export async function parseArguments(command: string, input: readonly Uint8Array[], context: ParserOptions): Promise<ParseResult> {
  context.signal?.throwIfAborted();
  const descriptor: CommandDescriptor | undefined = commands.find(item => item.name === command);
  if (!descriptor) throw new TypeError(`Unknown csvkit executable: ${command}`);
  const owned = new OwnedArguments(input, context.limits);
  const args = Array.from({ length: owned.length }, (_, index) => decodeArgument(owned.bytes(index)!));
  const options = commandDefaults(descriptor, context.env);
  const flags = new Map<string, ArgumentDescriptor>();
  for (const action of descriptor.actions) for (const flag of action.optionStrings) flags.set(flag, action);
  const positional = descriptor.actions.filter(action => action.optionStrings.length === 0);
  const extras: string[] = [];
  let positionalIndex = 0;
  let terminated = false;
  const error = (message: string): ParseResult => ({ kind: "exit", status: 2, stdout: "", stderr: descriptor.usage + command + ": error: " + message + "\n" });
  const optional = (arg: string): boolean => {
    if (terminated || arg.length < 2 || !arg.startsWith("-")) return false;
    const flag = arg.split("=", 1)[0]!;
    if (flags.has(flag) || (arg.startsWith("--")
      ? [...flags.keys()].some(candidate => candidate.startsWith(flag))
      : flags.has(arg.slice(0, 2)))) return true;
    return !negativeNumber(arg) && !arg.includes(" ");
  };
  const label = (action: ArgumentDescriptor): string => action.optionStrings.join("/") || action.dest;
  const files = new MatchFileScope();
  context.registerCleanup?.(files.dispose);
  let transferred = false;
  let escapingFailure = false;
  const convert = async (action: ArgumentDescriptor, text: string): Promise<unknown | ParseResult> => {
    if (action.type === "builtins.int") {
      if (action.dest === "field_size_limit" && text === "Infinity") return Infinity;
      const value = integer(text);
      if (value === undefined) return error(`argument ${label(action)}: invalid int value: ${repr(text)}`);
      if (action.choices && !action.choices.includes(value as number)) {
        return error(`argument ${label(action)}: invalid choice: ${repr(String(value))} (choose from ${action.choices.join(", ")})`);
      }
      return value;
    }
    if (action.choices && !action.choices.includes(text)) {
      return error(`argument ${label(action)}: invalid choice: ${repr(text)} (choose from ${action.choices.join(", ")})`);
    }
    if (action.type?.startsWith("FileType(")) {
      if (!context.openMatchFile) throw new CsvkitBlocked("csvgrep match-file opening capability");
      try {
        const file = await files.acquire(() => context.openMatchFile!(text));
        context.signal?.throwIfAborted();
        if (files.closed) throw new TypeError("match-file scope closed");
        return file;
      } catch (failure) {
        context.signal?.throwIfAborted();
        if (files.closed) throw failure;
        return error(`argument ${label(action)}: can't open ${repr(text)}: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    }
    return text;
  };
  const isExit = (value: unknown): value is Extract<ParseResult, { kind: "exit" }> => typeof value === "object" && value !== null && "kind" in value && value.kind === "exit";
  try {
  for (let index = 0; index < args.length; index++) {
    context.signal?.throwIfAborted();
    const token = args[index]!;
    if (token === "--" && !terminated) {
      terminated = true;
      if (!positional[positionalIndex]) extras.push(token);
      continue;
    }
    if (!optional(token)) {
      const action = positional[positionalIndex];
      if (!action) { extras.push(token); continue; }
      if (action.nargs === "*") {
        const values = [token];
        while (index + 1 < args.length) {
          if (!terminated && args[index + 1] === "--") { terminated = true; index++; continue; }
          if (optional(args[index + 1]!)) break;
          values.push(args[++index]!);
        }
        options[action.dest] = values;
      } else {
        options[action.dest] = token;
        // argparse's optional positional pattern also consumes an adjacent
        // terminator; a terminator in a later group remains an extra operand.
        if (!terminated && args[index + 1] === "--") { terminated = true; index++; }
      }
      positionalIndex++;
      continue;
    }
    const equal = token.indexOf("=");
    let flag = equal === -1 ? token : token.slice(0, equal);
    let explicit = equal === -1 ? undefined : token.slice(equal + 1);
    let equalsSeparator = equal !== -1;
    let action = flags.get(flag);
    if (!action && token.startsWith("--")) {
      const matches = [...flags.keys()].filter(candidate => candidate.startsWith(flag));
      if (matches.length > 1) return error(`ambiguous option: ${token} could match ${matches.join(", ")}`);
      if (matches.length === 1) { flag = matches[0]!; action = flags.get(flag); }
    }
    if (!action && !token.startsWith("--")) {
      flag = token.slice(0, 2);
      action = flags.get(flag);
      if (action) { explicit = token.slice(2) || undefined; equalsSeparator = false; }
    }
    if (!action) { extras.push(token); continue; }
    for (;;) {
      if (action.nargs === 0 && explicit !== undefined && (token.startsWith("--") || equalsSeparator)) {
        return error(`argument ${label(action)}: ignored explicit argument ${repr(explicit)}`);
      }
      if (action.action === "_HelpAction") return { kind: "exit", status: 0, stdout: descriptor.help, stderr: "" };
      if (action.action === "_VersionAction") return { kind: "exit", status: 0, stdout: `${command} 2.2.0\n`, stderr: "" };
      if (action.nargs === 0) {
        options[action.dest] = action.const;
        if (explicit !== undefined) {
          if (token.startsWith("--") || equalsSeparator || explicit.startsWith("-")) return error(`argument ${label(action)}: ignored explicit argument ${repr(explicit)}`);
          const nextFlag = "-" + explicit[0]!;
          const nextAction = flags.get(nextFlag);
          if (!nextAction) { extras.push("-" + explicit); break; }
          action = nextAction;
          const remainder = explicit.slice(1);
          equalsSeparator = remainder.startsWith("=");
          explicit = equalsSeparator ? remainder.slice(1) : remainder || undefined;
          continue;
        }
        break;
      }
      const count = action.nargs === "+" ? undefined : typeof action.nargs === "number" ? action.nargs : 1;
      if (explicit !== undefined && count !== undefined && count > 1) return error(`argument ${label(action)}: expected ${count} arguments`);
      const values: string[] = [];
      if (explicit !== undefined) values.push(explicit);
      else {
        while (index + 1 < args.length && args[index + 1] !== "--" &&
          (typeof action.nargs === "number" || !optional(args[index + 1]!)) &&
          (count === undefined || values.length < count)) values.push(args[++index]!);
      }
      if (values.length === 0 || (count !== undefined && values.length !== count)) {
        return error(`argument ${label(action)}: expected ${count === 1 ? "one argument" : count === undefined ? "at least one argument" : `${count} arguments`}`);
      }
      const converted: unknown[] = [];
      for (const value of values) {
        const convertedValue = await convert(action, value);
        if (isExit(convertedValue)) return convertedValue;
        converted.push(convertedValue);
      }
      const value = action.nargs === null ? converted[0] : converted;
      if (action.action === "_AppendAction") {
        const existing = options[action.dest];
        options[action.dest] = [...(Array.isArray(existing) ? existing : []), value];
      } else options[action.dest] = value;
      break;
    }
  }
  if (extras.length) return error("unrecognized arguments: " + extras.join(" "));
  context.signal?.throwIfAborted();
  if (files.closed) throw new TypeError("match-file scope closed");
  transferred = true;
  return { kind: "parsed", options: Object.freeze(options), dispose: files.dispose, matchFiles: files };
  } catch (failure) {
    escapingFailure = true;
    throw failure;
  } finally {
    if (!transferred) await disposeAfterParse(files, context.signal, escapingFailure);
  }
}
