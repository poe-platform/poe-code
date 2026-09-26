import { isAbsolutePath, validatePath } from "@poe-code/safe-fs/core";
import {
  CommandArgumentIdentityError,
  FsError,
  readBytes,
  shellValueByteLength,
  writeBytes,
  type ByteSink,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandHandler,
  type CommandResult,
  type InternalErrorHandler,
  type VirtualShellPlugin,
} from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import { yieldTurn } from "safe-bash-contracts/yield";

const encoder = new TextEncoder();
const blockSize = 8192;
const controls: Readonly<Record<number, string>> = { 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 92: "\\\\" };

class UsageError extends PublicDiagnostic {}

function publicDiagnosticMessage(error: unknown, onInternalError?: InternalErrorHandler): string {
  if (error instanceof FsError || error instanceof CommandArgumentIdentityError) return error.message;
  if (error instanceof PublicDiagnostic && !Object.hasOwn(error, "cause")) return error.message;
  const original: unknown = error instanceof PublicDiagnostic ? error.cause : error;
  const detail = error instanceof PublicDiagnostic ? error.message : "internal error";
  try {
    const pending = onInternalError?.(original);
    if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined);
  } catch {
    return detail;
  }
  return detail;
}

function pathOf(context: Pick<CommandContext, "cwd">, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  validatePath(path);
  validatePath(context.cwd);
  if (!isAbsolutePath(context.cwd)) throw new FsError("EINVAL", { path: context.cwd, message: "cwd must be absolute" });
  return isAbsolutePath(path) ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

async function writeDiagnostic(sink: ByteSink, value: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let chunk = "", bytes = 0, work = 0;
  for (const character of value) {
    signal?.throwIfAborted();
    const point = character.codePointAt(0)!;
    const parts = (point === 9 || point === 10 || (point >= 32 && (point < 127 || point > 159)))
      ? [character]
      : Array.from(encoder.encode(character), byte => controls[byte] ?? (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`));
    for (const part of parts) {
      const size = shellValueByteLength(part);
      if (bytes + size > 16_384) {
        await writeBytes(sink, encoder.encode(chunk), signal);
        chunk = ""; bytes = 0;
      }
      chunk += part; bytes += size;
      if (++work % 1024 === 0) await yieldTurn(signal);
    }
  }
  if (bytes) await writeBytes(sink, encoder.encode(chunk), signal);
  signal?.throwIfAborted();
}

export interface OdLimits {
  readonly maxInputBytes: number;
}

export interface OdCommandOptions {
  readonly limits?: Partial<OdLimits>;
  readonly maxInputBytes?: number;
}

export interface OdCommandsOptions extends OdCommandOptions {
  readonly replace?: boolean;
}

interface ParsedOptions {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly operands: string[];
}

function resolveMaxInputBytes(optionsOrLimit: number | OdCommandOptions | undefined): number {
  if (typeof optionsOrLimit === "number") return optionsOrLimit;
  const maxInputBytes = optionsOrLimit?.limits?.maxInputBytes ?? optionsOrLimit?.maxInputBytes;
  if (maxInputBytes === undefined) return Infinity;
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 0) {
    throw new RangeError("maxInputBytes must be a nonnegative safe integer");
  }
  return maxInputBytes;
}

function parseOptions(
  args: readonly string[],
  short: string,
  long: Readonly<Record<string, string | false>> = {},
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  const specifications = new Map<string, boolean>();
  for (let index = 0; index < short.length; index++) {
    const key = short[index]!;
    specifications.set(key, short[index + 1] === ":");
    if (short[index + 1] === ":") index++;
  }
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      continue;
    }
    if (argument === "--") {
      ended = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const alias = long[name];
      const longValue = typeof alias === "string" && alias.endsWith(":");
      const key = alias === false ? name : longValue ? alias.slice(0, -1) : alias;
      if (!key || (alias !== false && !longValue && !specifications.has(key))) throw new UsageError(`unrecognized option '${argument}'`);
      if (longValue || specifications.get(key)) {
        const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
        if (value === undefined) throw new UsageError(`option '--${name}' requires an argument`);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
      } else if (equals >= 0) throw new UsageError(`option '--${name}' does not take an argument`);
      flags.add(key);
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      const key = argument[offset]!;
      if (!specifications.has(key)) throw new UsageError(`invalid option -- '${key}'`);
      if (specifications.get(key)) {
        const value = argument.slice(offset + 1) || args[++index];
        if (value === undefined) throw new UsageError(`option requires an argument -- '${key}'`);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
        offset = argument.length;
      }
      flags.add(key);
    }
  }
  return { flags, values, operands };
}

function validatedOption<Value>(parsed: ParsedOptions, key: string, parse: (text: string) => Value, fallback: Value): Value {
  let result = fallback;
  for (const text of parsed.values.get(key) ?? []) result = parse(text);
  return result;
}

function output(context: CommandContext, text: string | Uint8Array): Promise<void> {
  context.signal.throwIfAborted();
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  const stdout = context.stdout as { isPipeStage?: boolean; writeSync?: (chunk: Uint8Array) => boolean };
  if (!stdout.isPipeStage && typeof stdout.writeSync === "function" && stdout.writeSync(bytes) !== false) {
    return Promise.resolve();
  }
  return writeBytes(context.stdout, bytes, context.signal);
}

class ByteInputBudget {
  #bytes = 0;
  #failure: FsError | undefined;

  constructor(readonly maxInputBytes: number) {}

  assertOpen(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.#failure) throw this.#failure;
  }

  async *read(source: ByteSource, signal: AbortSignal): ByteSource {
    this.assertOpen(signal);
    for await (const chunk of readBytes(source, signal)) {
      this.assertOpen(signal);
      if (chunk.byteLength > this.maxInputBytes - this.#bytes) {
        this.#failure = new FsError("EFBIG", { message: "byte command input limit exceeded" });
        throw this.#failure;
      }
      this.#bytes += chunk.byteLength;
      yield chunk;
      this.assertOpen(signal);
    }
  }
}

async function* sources(context: CommandContext, operands: readonly string[], maxInputBytes: number): ByteSource {
  const budget = new ByteInputBudget(maxInputBytes);
  let usedStdin = false;
  let emptyChunks = 0;
  for (const operand of operands.length ? operands : ["-"]) {
    budget.assertOpen(context.signal);
    let source: ByteSource;
    if (operand === "-") {
      if (usedStdin) continue;
      usedStdin = true;
      source = context.stdin;
    } else {
      const path = pathOf(context, operand);
      if (!context.fs.readStream) throw new FsError("ENOTSUP", { path, syscall: "readStream", message: "encoding commands require a streaming-read filesystem" });
      source = context.fs.readStream(path, { signal: context.signal, chunkSize: blockSize });
    }
    let slicesSinceYield = 0;
    for await (const chunk of budget.read(source, context.signal)) {
      if (chunk.length === 0 && ++emptyChunks % 64 === 0) {
        await yieldTurn();
        context.signal.throwIfAborted();
      }
      for (let offset = 0; offset < chunk.length; offset += blockSize) {
        if (offset > 0 || ++slicesSinceYield >= 8) {
          slicesSinceYield = 0;
          await yieldTurn();
        }
        context.signal.throwIfAborted();
        yield chunk.subarray(offset, offset + blockSize);
      }
    }
  }
}

async function* range(source: ByteSource, skip: number, count: number): ByteSource {
  if (!skip && !count) return;
  for await (const chunk of source) {
    const skipped = Math.min(skip, chunk.length);
    skip -= skipped;
    const length = Math.min(count, chunk.length - skipped);
    if (length) {
      yield chunk.subarray(skipped, skipped + length);
      count -= length;
    }
    if (!skip && !count) return;
  }
  if (skip) throw new PublicDiagnostic("cannot skip past end of input");
}

async function* rows(source: ByteSource, width: number): ByteSource {
  const row = new Uint8Array(width);
  let used = 0;
  for await (const chunk of source) {
    let offset = 0;
    if (used > 0) {
      const length = Math.min(width - used, chunk.length);
      row.set(chunk.subarray(0, length), used);
      offset += length;
      used += length;
      if (used === width) {
        yield row.slice();
        used = 0;
      }
    }
    while (offset + width <= chunk.length) {
      yield chunk.subarray(offset, offset + width);
      offset += width;
    }
    if (offset < chunk.length) {
      const rem = chunk.length - offset;
      row.set(chunk.subarray(offset), 0);
      used = rem;
    }
  }
  if (used) yield row.slice(0, used);
}

function numeric(text: string, suffixes = false): number {
  let numberText = text;
  let multiplier = 1;
  if (suffixes && !/^0[xX][0-9a-fA-F]+$/u.test(text)) {
    const match = /^(.*?)(KiB|MiB|GiB|KB|MB|GB|[bkmKMG])$/u.exec(text);
    if (match) {
      numberText = match[1] || "1";
      multiplier = (
        {
          b: 512,
          k: 1024,
          K: 1024,
          KiB: 1024,
          m: 1048576,
          M: 1048576,
          MiB: 1048576,
          G: 1073741824,
          GiB: 1073741824,
          KB: 1000,
          MB: 1000000,
          GB: 1000000000,
        } as Record<string, number>
      )[match[2]!]!;
    }
  }
  let parsed: number;
  if (/^0[xX][0-9a-fA-F]+$/u.test(numberText)) parsed = Number.parseInt(numberText.slice(2), 16);
  else if (/^0[0-7]*$/u.test(numberText)) parsed = Number.parseInt(numberText, 8);
  else if (/^[1-9][0-9]*$/u.test(numberText)) parsed = Number(numberText);
  else throw new UsageError(`invalid number '${text}'`);
  parsed *= multiplier;
  if (!Number.isSafeInteger(parsed)) throw new UsageError(`number out of range '${text}'`);
  return parsed;
}

function addOffset(offset: number, length: number): number {
  const result = offset + length;
  if (!Number.isSafeInteger(result)) throw new PublicDiagnostic("input address exceeds safe integer range");
  return result;
}

const OD_OPTIONS = [
  "-A, --address-radix=RADIX",
  "-j, --skip-bytes=NUM",
  "-N, --read-bytes=NUM",
  "-t, --format=TYPE, --type=TYPE",
  "-w, --width=NUM",
  "--endian=ORDER",
  "-v, --output-duplicates",
];

async function handleOdGnuInfo(context: CommandContext): Promise<CommandResult | undefined> {
  if (!context.args.includes("--help") && !context.args.includes("--version")) return undefined;
  const flags = new Map<string, "none" | "required" | "optional">();
  for (const option of OD_OPTIONS) {
    const takesValue = option.includes("[=") ? "optional" : option.includes("=") ? "required" : "none";
    for (const spelling of option.split(", ")) flags.set(spelling.split("=")[0]!.split("[")[0]!, takesValue);
  }
  for (let index = 0; index < context.args.length; index++) {
    const arg = context.args[index]!;
    if (arg === "--") break;
    if (arg === "--help" || arg === "--version") {
      const text =
        arg === "--version"
          ? "od (safe-bash virtual implementation)\n"
          : `Usage: od [OPTION]... [FILE]...\nPrint input bytes in selected numeric formats.\n\nCommon supported options (additional behavior is documented in the package):\n${OD_OPTIONS.map(option => `  ${option.split(", ").map(spelling => (spelling.startsWith("--") ? spelling : spelling.replace("=", " "))).join(", ")}`).join("\n")}\n  --help     display this help and exit\n  --version  display implementation information and exit\n\nThis is the safe-bash virtual implementation; filesystem operations require backend capabilities.\n`;
      await writeBytes(context.stdout, encoder.encode(text), context.signal);
      return { exitCode: 0 };
    }
    if (!arg.startsWith("-") || arg === "-") continue;
    if (arg.startsWith("--")) {
      const equal = arg.indexOf("=");
      const spelling = equal < 0 ? arg : arg.slice(0, equal);
      if (!flags.has(spelling)) return undefined;
      if (flags.get(spelling) === "required" && equal < 0) index++;
      else if (flags.get(spelling) === "none" && equal >= 0) return undefined;
    } else {
      for (let offset = 1; offset < arg.length; offset++) {
        const spelling = `-${arg[offset]}`;
        if (!flags.has(spelling)) return undefined;
        if (flags.get(spelling) === "required") {
          if (offset + 1 === arg.length) index++;
          break;
        }
      }
    }
  }
  return undefined;
}

interface Format {
  readonly kind: string;
  readonly size: number;
  readonly printable?: boolean;
}

function formats(text: string): Format[] {
  const result: Format[] = [];
  const sizeMap: Record<string, number> = { C: 1, S: 2, I: 4, L: 8, F: 4, D: 8 };
  for (let offset = 0; offset < text.length; ) {
    const kind = text[offset++]!;
    let size = 1;
    if (kind !== "a" && kind !== "c") {
      if (!"doux".includes(kind) && kind !== "f") {
        throw new UsageError(`unsupported type '${text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8`);
      }
      const next = text[offset];
      if (next !== undefined && ((next >= "0" && next <= "9") || Object.hasOwn(sizeMap, next))) {
        size = sizeMap[next] ?? Number(next);
        offset++;
      } else {
        size = kind === "f" ? 8 : 4;
      }
      if (!(kind === "f" ? [4, 8] : [1, 2, 4, 8]).includes(size)) {
        throw new UsageError(`unsupported type '${text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8`);
      }
    }
    let printable = false;
    if (text[offset] === "z") {
      printable = true;
      offset++;
    }
    result.push({ kind, size, ...(printable ? { printable: true } : {}) });
    if (result.length > 16) throw new UsageError("at most 16 output types are supported");
  }
  if (!result.length) throw new UsageError("empty output type");
  return result;
}

function floating(value: number, size: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (Object.is(value, -0)) return "-0";
  const minimumNormal = size === 4 ? 2 ** -126 : 2 ** -1022;
  let precision = Math.abs(value) < minimumNormal ? 1 : size === 4 ? 6 : 15;
  const maximum = size === 4 ? 9 : 17;
  while (precision < maximum) {
    const parsed = Number(value.toPrecision(precision));
    if (Object.is(size === 4 ? Math.fround(parsed) : parsed, value)) break;
    precision++;
  }
  const rounded = Number(value.toPrecision(precision));
  const exponent = rounded === 0 ? 0 : Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= precision) {
    const [mantissa, power] = rounded.toExponential().split("e");
    const numericPower = Number(power);
    return `${mantissa}e${numericPower < 0 ? "-" : "+"}${String(Math.abs(numericPower)).padStart(2, "0")}`;
  }
  return String(rounded);
}

const OD_ESCAPES: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
const OD_NAMES = [
  "nul",
  "soh",
  "stx",
  "etx",
  "eot",
  "enq",
  "ack",
  "bel",
  "bs",
  "ht",
  "nl",
  "vt",
  "ff",
  "cr",
  "so",
  "si",
  "dle",
  "dc1",
  "dc2",
  "dc3",
  "dc4",
  "nak",
  "syn",
  "etb",
  "can",
  "em",
  "sub",
  "esc",
  "fs",
  "gs",
  "rs",
  "us",
  "sp",
];
const OD_HEX1_TABLE = Array.from({ length: 256 }, (_, i) => " " + i.toString(16).padStart(2, "0"));
const OD_OCT1_TABLE = Array.from({ length: 256 }, (_, i) => " " + i.toString(8).padStart(3, "0"));
const OD_ASCII_CHAR = Array.from({ length: 256 }, (_, i) => (i >= 32 && i <= 126 ? String.fromCharCode(i) : "."));

function formatRow(row: Uint8Array, format: Format, bigEndian: boolean): string {
  let text = "";
  if (format.size === 1 && (format.kind === "x" || format.kind === "o")) {
    const table = format.kind === "x" ? OD_HEX1_TABLE : OD_OCT1_TABLE;
    for (let i = 0; i < row.length; i++) text += table[row[i]!]!;
    if (format.printable) {
      let ascii = "";
      for (let i = 0; i < row.length; i++) ascii += OD_ASCII_CHAR[row[i]!]!;
      text += `  >${ascii}<`;
    }
    return text;
  }
  const escapes = OD_ESCAPES;
  const names = OD_NAMES;
  for (let offset = 0; offset < row.length; offset += format.size) {
    if (format.kind === "a") {
      const byte = row[offset]! & 127;
      text += ` ${(names[byte] ?? (byte === 127 ? "del" : String.fromCharCode(byte))).padStart(3)}`;
      continue;
    }
    if (format.kind === "f") {
      const bytes = new Uint8Array(format.size);
      bytes.set(row.subarray(offset, offset + format.size));
      const view = new DataView(bytes.buffer);
      const value = format.size === 4 ? view.getFloat32(0, !bigEndian) : view.getFloat64(0, !bigEndian);
      text += ` ${floating(value, format.size).padStart(format.size === 4 ? 15 : 24)}`;
      continue;
    }
    if (format.kind === "c") {
      const byte = row[offset]!;
      const character = escapes[byte] ?? (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, "0"));
      text += ` ${character.padStart(3)}`;
      continue;
    }
    let number = 0n;
    for (let index = 0; index < format.size; index++) {
      const byte = row[offset + index] ?? 0;
      const shift = bigEndian ? format.size - index - 1 : index;
      number |= BigInt(byte) << BigInt(shift * 8);
    }
    const bits = format.size * 8;
    if (format.kind === "d" && number >= 1n << BigInt(bits - 1)) number -= 1n << BigInt(bits);
    const base = format.kind === "o" ? 8 : format.kind === "x" ? 16 : 10;
    const width =
      format.kind === "o"
        ? Math.ceil(bits / 3)
        : format.kind === "x"
          ? bits / 4
          : format.kind === "d"
            ? (1n << BigInt(bits - 1)).toString().length + 1
            : ((1n << BigInt(bits)) - 1n).toString().length;
    text += ` ${number.toString(base).padStart(width, base === 10 ? " " : "0")}`;
  }
  if (format.printable) {
    let ascii = "";
    for (const byte of row) ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
    text += `  >${ascii}<`;
  }
  return text;
}

function defineOdCommand(handler: CommandHandler): CommandDefinition {
  return {
    name: "od",
    async execute(context): Promise<CommandResult> {
      try {
        context.signal.throwIfAborted();
        const info = await handleOdGnuInfo(context);
        if (info) return info;
        return await handler(context);
      } catch (error) {
        context.signal.throwIfAborted();
        await writeDiagnostic(
          context.stderr,
          `${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`,
          context.signal,
        );
        return { exitCode: error instanceof UsageError ? 2 : 1 };
      }
    },
  };
}

export function createOdCommand(optionsOrMaxBytes?: number | OdCommandOptions): CommandDefinition {
  const maxInputBytes = resolveMaxInputBytes(optionsOrMaxBytes);
  return defineOdCommand(async context => {
    const aliases: Record<string, string> = {
      a: "a",
      b: "o1",
      B: "o2",
      c: "c",
      d: "u2",
      D: "u4",
      e: "f8",
      f: "f4",
      F: "f8",
      h: "x2",
      i: "d4",
      I: "d8",
      l: "d8",
      L: "d8",
      o: "o2",
      O: "o4",
      s: "d2",
      x: "x2",
      X: "x4",
    };
    const rewritten: string[] = [];
    let ended = false;
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) {
        rewritten.push(argument);
        continue;
      }
      if (argument === "--") {
        ended = true;
        rewritten.push(argument);
        continue;
      }
      if (argument.startsWith("--")) {
        if (argument === "--strings") {
          rewritten.push("-S3");
          continue;
        }
        if (argument === "--width") {
          const next = context.args[index + 1];
          if (next && [...next].every(c => c >= "0" && c <= "9")) {
            rewritten.push(`-w${next}`);
            index++;
          } else rewritten.push("-w32");
          continue;
        }
        rewritten.push(argument);
        if (!argument.includes("=") && ["--address-radix", "--skip-bytes", "--read-bytes", "--format", "--type", "--endian"].includes(argument)) {
          const parameter = context.args[++index];
          if (parameter === undefined) throw new UsageError(`option '${argument}' requires an argument`);
          rewritten.push(parameter);
        }
        continue;
      }
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (flag === "S") {
          let parameter = argument.slice(offset + 1);
          const next = context.args[index + 1];
          if (!parameter && next && [...next].every(character => character >= "0" && character <= "9")) {
            parameter = next;
            index++;
          }
          rewritten.push(`-S${parameter || "3"}`);
          break;
        }
        if (
          flag === "e" &&
          (argument.slice(offset + 1) === "big" ||
            argument.slice(offset + 1) === "little" ||
            context.args[index + 1] === "big" ||
            context.args[index + 1] === "little")
        ) {
          throw new UsageError("use --endian=little or --endian=big; -e is unsupported");
        }
        if (flag === "w") {
          let parameter = argument.slice(offset + 1);
          const next = context.args[index + 1];
          if (!parameter && next && [...next].every(character => character >= "0" && character <= "9")) {
            parameter = next;
            index++;
          }
          rewritten.push(`-w${parameter || "32"}`);
          break;
        }
        if (aliases[flag]) rewritten.push(`-t${aliases[flag]}`);
        else if ("AjNt".includes(flag)) {
          const parameter = argument.slice(offset + 1) || context.args[++index];
          if (parameter === undefined) throw new UsageError(`option '-${flag}' requires an argument`);
          rewritten.push(`-${flag}`, parameter);
          break;
        } else rewritten.push(`-${flag}`);
      }
    }
    const parsed = parseOptions(rewritten, "vA:j:N:t:w:S:", {
      "address-radix": "A",
      "skip-bytes": "j",
      "read-bytes": "N",
      format: "t",
      type: "t",
      width: "w",
      endian: "endian:",
      "output-duplicates": "v",
      strings: "S",
    });
    const radix = validatedOption(
      parsed,
      "A",
      text => {
        if (!["d", "o", "x", "n"].includes(text)) throw new UsageError("address radix must be d, o, x, or n");
        return text;
      },
      "o",
    );
    const endian = validatedOption(
      parsed,
      "endian",
      text => {
        if (text !== "little" && text !== "big") throw new UsageError("endian must be little or big");
        return text;
      },
      "little",
    );
    const selected = (parsed.values.get("t") ?? ["o2"]).flatMap(formats);
    const width = validatedOption(
      parsed,
      "w",
      text => {
        const number = numeric(text);
        if (number < 1 || selected.some(format => number % format.size !== 0)) {
          throw new UsageError("width must be positive and a multiple of each output type size");
        }
        return number;
      },
      16,
    );
    const skip = validatedOption(parsed, "j", text => numeric(text, true), 0);
    const count = validatedOption(parsed, "N", text => numeric(text, true), Infinity);
    const minimumStringLength = validatedOption(
      parsed,
      "S",
      text => {
        const number = numeric(text);
        if (number < 1) throw new UsageError("minimum string length must be positive");
        return number;
      },
      3,
    );
    let offset = skip;
    let previous: Uint8Array | undefined;
    let suppressed = false;
    const address = (): string =>
      radix === "n" ? "" : offset.toString(radix === "o" ? 8 : radix === "x" ? 16 : 10).padStart(radix === "x" ? 6 : 7, "0");
    if (parsed.values.has("S")) {
      let text = "";
      let length = 0;
      let start = "";
      for await (const chunk of range(sources(context, parsed.operands, maxInputBytes), skip, count)) {
        for (const byte of chunk) {
          if (byte >= 32 && byte <= 126) {
            if (!length) start = address();
            text += String.fromCharCode(byte);
            length++;
          } else {
            if (byte === 0 && length >= minimumStringLength) await output(context, `${start ? start + " " : ""}${text}\n`);
            text = "";
            length = 0;
          }
          offset = addOffset(offset, 1);
        }
      }
      return { exitCode: 0 };
    }
    const verbose = parsed.flags.has("v");
    const isBigEndian = endian === "big";
    let outBuf = "";
    let flushedFirst = false;
    const writeOut = async (text: string) => {
      outBuf += text;
      if (!flushedFirst || outBuf.length >= 8192) {
        flushedFirst = true;
        const chunk = outBuf;
        outBuf = "";
        await output(context, chunk);
      }
    };
    for await (const row of rows(range(sources(context, parsed.operands, maxInputBytes), skip, count), width)) {
      let same = false;
      if (!verbose && previous !== undefined && previous.length === row.length) {
        same = true;
        for (let i = 0; i < row.length; i++) {
          if (previous[i] !== row[i]) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        if (!suppressed) await writeOut("*\n");
        suppressed = true;
      } else {
        const addr = address();
        const pad = selected.length > 1 ? " ".repeat(addr.length) : "";
        for (let index = 0; index < selected.length; index++) {
          const prefix = index === 0 ? addr : pad;
          await writeOut(`${prefix}${formatRow(row, selected[index]!, isBigEndian)}\n`);
        }
        if (previous === undefined || previous.length !== row.length) previous = row.slice();
        else previous.set(row);
        suppressed = false;
      }
      offset = addOffset(offset, row.length);
    }
    if (radix !== "n") await writeOut(`${address()}\n`);
    if (outBuf) await output(context, outBuf);
    return { exitCode: 0 };
  });
}

export function createOdCommands(options: OdCommandsOptions = {}): readonly CommandDefinition[] {
  return [createOdCommand(options)];
}

export function odCommands(options: OdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOdCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "od-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
