export type RelativeMode = "absolute" | "relative" | "<" | ">" | "/" | "%";
export const maximumSize = (1n << 63n) - 1n;
export const minimumSize = -(1n << 63n);

export class TruncateError extends Error {
  constructor(message: string, readonly usage = false, readonly raw = false) { super(message); }
}

export function argumentBytes(value: string): Uint8Array {
  return Uint8Array.from(value, character => character.charCodeAt(0));
}

const escapes = new Map([[7, "a"], [8, "b"], [9, "t"], [10, "n"], [11, "v"], [12, "f"], [13, "r"]]);

export function quote(value: string, numeric = false): string {
  const bytes = argumentBytes(value);
  if (!numeric && bytes.every(byte => byte >= 32 && byte < 127)) {
    return value.includes("'") && !["\"", "$", "`", "\\"].some(character => value.includes(character))
      ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
  }
  let result = "'", escaped = false;
  for (const byte of bytes) {
    const special = byte < 32 || byte >= 127;
    if (!numeric && special !== escaped) {
      result += special ? "'$'" : "''";
      escaped = special;
    }
    result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
      : numeric && (byte === 39 || byte === 92) ? `\\${String.fromCharCode(byte)}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
}

export interface TruncateArguments {
  readonly files: readonly string[];
  readonly noCreate: boolean;
  readonly ioBlocks: boolean;
  readonly reference?: string;
  readonly size?: bigint;
  readonly mode: RelativeMode;
  readonly display?: "help" | "version";
}

function skipSpace(value: string): string {
  let offset = 0;
  while (offset < value.length && " \t\n\r\v\f".includes(value[offset]!)) offset++;
  return value.slice(offset);
}

function parseSize(value: string, previousMode: RelativeMode): { size: bigint; mode: RelativeMode } {
  let text = skipSpace(value), mode = previousMode;
  if (text[0] === "<" || text[0] === ">" || text[0] === "/" || text[0] === "%") {
    mode = text[0];
    text = skipSpace(text.slice(1));
  }
  if (text[0] === "+" || text[0] === "-") {
    if (mode !== "absolute") throw new TruncateError("multiple relative modifiers specified", true);
    mode = "relative";
  }
  const negative = text[0] === "-", signed = negative || text[0] === "+";
  let offset = signed ? 1 : 0, amount = 0n;
  const start = offset;
  while (offset < text.length && text[offset]! >= "0" && text[offset]! <= "9") {
    if (amount <= maximumSize + 1n) amount = amount * 10n + BigInt(text.charCodeAt(offset) - 48);
    offset++;
  }
  const suffix = text.slice(offset);
  const invalid = () => new TruncateError(`Invalid number: ${quote(text, true)}`);
  if (offset === start) {
    if (signed || !suffix) throw invalid();
    amount = 1n;
  }
  if (suffix) {
    const powers: Readonly<Record<string, number>> = { k: 1, K: 1, m: 2, M: 2, g: 3, G: 3, t: 4, T: 4, P: 5, E: 6, Z: 7, Y: 8, R: 9, Q: 10 };
    const power = powers[suffix[0]!], tail = suffix.slice(1);
    if (power === undefined || (tail !== "" && tail !== "B" && tail !== "D" && tail !== "iB")) throw invalid();
    amount *= (tail === "B" || tail === "D" ? 1000n : 1024n) ** BigInt(power);
  }
  if (negative) amount = -amount;
  if (amount < minimumSize || amount > maximumSize) throw new TruncateError(`Invalid number: ${quote(text, true)}: Value too large to be stored in data type`);
  if ((mode === "/" || mode === "%") && amount === 0n) throw new TruncateError("division by zero");
  return { size: amount, mode };
}

export function parseArguments(args: readonly string[], posix: boolean, owned?: CommandArguments): TruncateArguments {
  const readArgument = (index: number): string | undefined => {
    const value = args[index];
    if (value === undefined) return undefined;
    return Array.from(owned?.bytes(index) ?? new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join("");
  };
  const files: string[] = [];
  let noCreate = false, ioBlocks = false, ended = false;
  let reference: string | undefined, size: bigint | undefined, mode: RelativeMode = "absolute";
  const longOptions: Readonly<Record<string, string>> = { "no-create": "c", "io-blocks": "o", reference: "r", size: "s", help: "help", version: "version" };
  for (let index = 0; index < args.length; index++) {
    const argument = readArgument(index)!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      files.push(argument);
      if (posix) ended = true;
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    const long = argument.startsWith("--");
    const equals = argument.indexOf("=");
    let name = argument.slice(2, equals < 0 ? undefined : equals);
    let keys = argument.slice(1);
    if (long) {
      const matching = Object.keys(longOptions).filter(option => option.startsWith(name));
      const matched = Object.hasOwn(longOptions, name) ? name : matching[0];
      if (!matched) throw new TruncateError(`unrecognized option '${argument}'`, true, true);
      if (!Object.hasOwn(longOptions, name) && matching.length > 1) throw new TruncateError(`option '${argument}' is ambiguous; possibilities: ${matching.map(option => `'--${option}'`).join(" ")}`, true, true);
      keys = longOptions[matched]!;
      name = matched;
    }
    if (long && (keys === "help" || keys === "version")) {
      if (equals >= 0) throw new TruncateError(`option '--${name}' doesn't allow an argument`, true);
      return { files, noCreate, ioBlocks, mode, display: keys };
    }
    for (let offset = 0; offset < keys.length; offset++) {
      const key = keys[offset]!;
      if (key !== "c" && key !== "o" && key !== "r" && key !== "s") throw new TruncateError(`invalid option -- '${key}'`, true, true);
      if (key === "c" || key === "o") {
        if (long && equals >= 0) throw new TruncateError(`option '--${name}' doesn't allow an argument`, true);
        if (key === "c") noCreate = true;
        else ioBlocks = true;
        continue;
      }
      const value = long ? equals >= 0 ? argument.slice(equals + 1) : readArgument(++index) : keys.slice(offset + 1) || readArgument(++index);
      if (value === undefined) throw new TruncateError(long ? `option '--${name}' requires an argument` : `option requires an argument -- '${key}'`, true);
      if (key === "r") reference = value;
      else ({ size, mode } = parseSize(value, mode));
      break;
    }
  }
  if (reference === undefined && size === undefined) throw new TruncateError("you must specify either '--size' or '--reference'", true);
  if (reference !== undefined && size !== undefined && mode === "absolute") throw new TruncateError("you must specify a relative '--size' with '--reference'", true);
  if (ioBlocks && size === undefined) throw new TruncateError("'--io-blocks' was specified but '--size' was not", true);
  if (files.length === 0) throw new TruncateError("missing file operand", true);
  return { files, noCreate, ioBlocks, mode, ...(reference === undefined ? {} : { reference }), ...(size === undefined ? {} : { size }) };
}

export const helpText = `Usage: truncate OPTION... FILE...
Shrink or extend the size of each FILE to the specified size

A FILE argument that does not exist is created.

If a FILE is larger than the specified size, the extra data is lost.
If a FILE is shorter, it is extended and the sparse extended part (hole)
reads as zero bytes.

Mandatory arguments to long options are mandatory for short options too.
  -c, --no-create        do not create any files
  -o, --io-blocks        treat SIZE as number of IO blocks instead of bytes
  -r, --reference=RFILE  base size on RFILE
  -s, --size=SIZE        set or adjust the file size by SIZE bytes
      --help        display this help and exit
      --version     output version information and exit

The SIZE argument is an integer and optional unit (example: 10K is 10*1024).
Units are K,M,G,T,P,E,Z,Y,R,Q (powers of 1024) or KB,MB,... (powers of 1000).
Binary prefixes can be used, too: KiB=K, MiB=M, and so on.

SIZE may also be prefixed by one of the following modifying characters:
'+' extend by, '-' reduce by, '<' at most, '>' at least,
'/' round down to multiple of, '%' round up to multiple of.

GNU coreutils online help: <https://www.gnu.org/software/coreutils/>
Report any translation bugs to <https://translationproject.org/team/>
Full documentation <https://www.gnu.org/software/coreutils/truncate>
or available locally via: info '(coreutils) truncate invocation'
`;
import type { CommandArguments } from "../../contracts/index.js";
