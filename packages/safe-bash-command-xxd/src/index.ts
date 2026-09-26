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

export interface XxdLimits {
  readonly maxInputBytes: number;
}

export interface XxdCommandOptions {
  readonly limits?: Partial<XxdLimits>;
  readonly maxInputBytes?: number;
}

export interface XxdCommandsOptions extends XxdCommandOptions {
  readonly replace?: boolean;
}

interface ParsedOptions {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly operands: string[];
}

function resolveMaxInputBytes(optionsOrLimit: number | XxdCommandOptions | undefined): number {
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

function requireOperands(operands: readonly string[], minimum = 1, maximum = Infinity): void {
  if (operands.length < minimum) throw new UsageError("missing operand");
  if (operands.length > maximum) throw new UsageError(`extra operand '${operands[maximum]}'`);
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

function numeric(text: string): number {
  let parsed: number;
  if (/^0[xX][0-9a-fA-F]+$/u.test(text)) parsed = Number.parseInt(text.slice(2), 16);
  else if (/^0[0-7]*$/u.test(text)) parsed = Number.parseInt(text, 8);
  else if (/^[1-9][0-9]*$/u.test(text)) parsed = Number(text);
  else throw new UsageError(`invalid number '${text}'`);
  if (!Number.isSafeInteger(parsed)) throw new UsageError(`number out of range '${text}'`);
  return parsed;
}

function addOffset(offset: number, length: number): number {
  const result = offset + length;
  if (!Number.isSafeInteger(result)) throw new PublicDiagnostic("input address exceeds safe integer range");
  return result;
}

const HEX_LOWER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const HEX_UPPER = HEX_LOWER.map(s => s.toUpperCase());
const BIN_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(2).padStart(8, "0"));
const ASCII_CHAR = Array.from({ length: 256 }, (_, i) => (i >= 32 && i <= 126 ? String.fromCharCode(i) : "."));

function hexDigit(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

async function reversePlain(context: CommandContext, files: readonly string[], maxInputBytes: number): Promise<void> {
  let high = -1;
  for await (const chunk of sources(context, files, maxInputBytes)) {
    const pending: number[] = [];
    for (const byte of chunk) {
      if (byte === 32 || (byte >= 9 && byte <= 13)) continue;
      const digit = hexDigit(byte);
      if (digit < 0) {
        high = -1;
        continue;
      }
      if (high < 0) high = digit;
      else {
        pending.push((high << 4) | digit);
        high = -1;
      }
    }
    if (pending.length) await output(context, Uint8Array.from(pending));
  }
}

async function reverseNormal(context: CommandContext, files: readonly string[], columns: number, maxInputBytes: number): Promise<void> {
  let line = "";
  let offset = 0;
  const outBuf = new Uint8Array(8192);
  let outUsed = 0;
  let flushedFirst = false;
  const flushOut = async () => {
    if (outUsed > 0) {
      flushedFirst = true;
      const chunk = outBuf.slice(0, outUsed);
      outUsed = 0;
      await output(context, chunk);
    }
  };
  const emitLine = async (): Promise<void> => {
    if (!line.trim()) {
      line = "";
      return;
    }
    const colon = line.indexOf(":");
    if (colon < 1 || colon > 14) throw new PublicDiagnostic("invalid input: expected hexadecimal address and colon");
    let address = 0;
    for (let index = 0; index < colon; index++) {
      const digit = hexDigit(line.charCodeAt(index));
      if (digit < 0) throw new PublicDiagnostic("invalid input: expected hexadecimal address and colon");
      address = address * 16 + digit;
    }
    if (!Number.isSafeInteger(address) || address !== offset) throw new PublicDiagnostic("invalid input: reverse requires contiguous addresses starting at zero");
    const pending: number[] = [];
    let high = -1;
    let spaces = 0;
    for (let index = colon + 1; index < line.length; index++) {
      const byte = line.charCodeAt(index);
      if (byte === 32 || byte === 9 || byte === 13) {
        spaces++;
        if (pending.length && spaces >= 2) break;
        continue;
      }
      const digit = hexDigit(byte);
      if (digit < 0) break;
      spaces = 0;
      if (high < 0) high = digit;
      else {
        pending.push((high << 4) | digit);
        high = -1;
        if (pending.length === columns) break;
      }
    }
    if (!pending.length) throw new PublicDiagnostic("invalid input: malformed hexadecimal data field");
    offset = addOffset(offset, pending.length);
    if (outUsed + pending.length > outBuf.length) await flushOut();
    for (let i = 0; i < pending.length; i++) outBuf[outUsed++] = pending[i]!;
    if (!flushedFirst || outUsed >= outBuf.length) await flushOut();
    line = "";
  };
  for await (const chunk of sources(context, files, maxInputBytes)) {
    for (const byte of chunk) {
      if (byte === 10) await emitLine();
      else line += String.fromCharCode(byte);
    }
  }
  if (line) await emitLine();
  await flushOut();
}

function defineCommand(name: string, handler: CommandHandler): CommandDefinition {
  return {
    name,
    async execute(context): Promise<CommandResult> {
      try {
        context.signal.throwIfAborted();
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

export function createXxdCommand(optionsOrMaxBytes?: number | XxdCommandOptions): CommandDefinition {
  const maxInputBytes = resolveMaxInputBytes(optionsOrMaxBytes);
  return defineCommand("xxd", async context => {
    const aliases: Record<string, string> = {
      "-ps": "-p",
      "-plain": "-p",
      "-postscript": "-p",
      "-revert": "-r",
      "-cols": "-c",
      "-groupsize": "-g",
      "-len": "-l",
      "-bits": "-b",
      "-include": "-i",
      "-name": "-n",
    };
    let ended = false;
    const args = context.args.map(argument => {
      if (ended) return argument;
      if (argument === "--") ended = true;
      return aliases[argument] ?? argument;
    });
    const parsed = parseOptions(args, "prdubiec:g:l:s:o:n:");
    requireOperands(parsed.operands, 0, 2);
    if (parsed.operands[1] !== undefined && parsed.operands[1] !== "-") {
      throw new UsageError("output-file operands are not supported; output is stdout only");
    }
    const files = parsed.operands.slice(0, 1);
    const plain = parsed.flags.has("p");
    const reverse = parsed.flags.has("r");
    const binary = parsed.flags.has("b");
    const include = parsed.flags.has("i");
    const littleEndian = parsed.flags.has("e");
    if ((plain && (binary || include || littleEndian)) || (littleEndian && (binary || include)) || (binary && include)) {
      throw new UsageError("incompatible display modes");
    }
    if (reverse && (binary || include || littleEndian)) throw new UsageError("cannot revert this type of hexdump");
    const columns = validatedOption(
      parsed,
      "c",
      text => {
        const number = numeric(text);
        if (!plain && number < 1) throw new UsageError("columns must be positive (plain: nonnegative)");
        return number;
      },
      plain ? 30 : include ? 12 : binary ? 6 : 16,
    );
    const group = validatedOption(
      parsed,
      "g",
      text => {
        const number = numeric(text);
        return number;
      },
      littleEndian ? 4 : binary ? 1 : 2,
    );
    if (littleEndian && group && !Number.isInteger(Math.log2(group))) {
      throw new UsageError("number of octets per group must be a power of 2 with -e");
    }
    const skip = validatedOption(parsed, "s", numeric, 0);
    const count = validatedOption(parsed, "l", numeric, Infinity);
    const displacement = validatedOption(parsed, "o", numeric, 0);
    if (reverse && ["s", "l", "o", "d"].some(flag => parsed.flags.has(flag))) {
      throw new UsageError("reverse does not support seek, length, displacement, or decimal addresses");
    }
    if (reverse) {
      if (plain) await reversePlain(context, files, maxInputBytes);
      else await reverseNormal(context, files, columns, maxInputBytes);
      return { exitCode: 0 };
    }
    let offset = addOffset(skip, displacement);
    const source = range(sources(context, files, maxInputBytes), skip, count);
    let any = false;
    let includeLength = 0;
    let includeRow = "";
    const includeName = parsed.values.get("n")?.at(-1) ?? (files[0] !== "-" ? files[0] : undefined);
    let identifier = "";
    if (includeName !== undefined) {
      for (const character of includeName) {
        const code = character.charCodeAt(0);
        identifier += (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ? character : "_";
      }
      if (identifier[0] && identifier[0] >= "0" && identifier[0] <= "9") identifier = "__" + identifier;
    }
    const upper = parsed.flags.has("u");
    const hexTable = upper ? HEX_UPPER : HEX_LOWER;
    const byteTable = binary ? BIN_TABLE : hexTable;
    const decimalAddress = parsed.flags.has("d");
    const octets = Math.min(group || columns, columns);
    const width = littleEndian
      ? Math.ceil(columns / octets) * (octets * 2 + 1) - 1
      : columns * (binary ? 8 : 2) + (group ? Math.floor((columns - 1) / group) : 0);
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
    if (include && includeName !== undefined) await writeOut(`unsigned char ${identifier}[] = {\n`);
    for await (const row of rows(source, plain && !columns ? 4096 : columns)) {
      any = true;
      if (include) {
        if (includeRow) await writeOut(includeRow + ",\n");
        const includePrefix = upper ? "0X" : "0x";
        includeRow = "  " + Array.from(row, byte => includePrefix + hexTable[byte]!).join(", ");
        includeLength = addOffset(includeLength, row.length);
        continue;
      }
      let data = "";
      let ascii = "";
      for (let index = 0; index < row.length; index++) {
        if (!plain && !littleEndian && group && index && index % group === 0) data += " ";
        const byte = row[index]!;
        if (!littleEndian) data += byteTable[byte]!;
        if (!plain) ascii += ASCII_CHAR[byte]!;
      }
      if (littleEndian) {
        for (let start = 0; start < row.length; start += octets) {
          if (start) data += " ";
          for (let index = start + octets - 1; index >= start; index--) {
            data += index < row.length ? hexTable[row[index]!]! : "  ";
          }
        }
      }
      if (plain) await writeOut(data + (columns ? "\n" : ""));
      else {
        const address = offset.toString(decimalAddress ? 10 : 16).padStart(8, "0");
        await writeOut(`${address}: ${data.padEnd(width)}  ${ascii}\n`);
      }
      offset = addOffset(offset, row.length);
    }
    if (include) {
      if (includeRow) await writeOut(includeRow + "\n");
      if (includeName !== undefined) await writeOut(`};\nunsigned int ${identifier}_len = ${includeLength};\n`);
    }
    if (plain && !columns && any) await writeOut("\n");
    if (outBuf) await output(context, outBuf);
    return { exitCode: 0 };
  });
}

export function createXxdCommands(options: XxdCommandsOptions = {}): readonly CommandDefinition[] {
  return [createXxdCommand(options)];
}

export function xxdCommands(options: XxdCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXxdCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "xxd-commands",
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
