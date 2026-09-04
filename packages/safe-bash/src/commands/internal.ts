import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { inputRequirements } from "./portable-requirements.js";
import { RecordBuffer } from "./record-buffer.js";
import {
  FsError, isAbsolutePath, readBytes, toByteSource, validatePath, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler,
} from "../contracts/index.js";

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
export const bufferLimit = 32 * 1024 * 1024;

export class UsageError extends Error {}

export interface ParsedOptions {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly operands: string[];
}

export function options(
  args: readonly string[], short: string, long: Readonly<Record<string, string>> = {},
  stopAtOperand = false, onOperand?: (index: number) => void,
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
      onOperand?.(index);
      if (stopAtOperand) ended = true;
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const key = long[name];
      if (!key || !specifications.has(key)) throw new UsageError(`unrecognized option '${argument}'`);
      if (specifications.get(key)) {
        const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
        if (value === undefined) throw new UsageError(`option '--${name}' requires an argument`);
        values.set(key, [...values.get(key) ?? [], value]);
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
        values.set(key, [...values.get(key) ?? [], value]);
        offset = argument.length;
      }
      flags.add(key);
    }
  }
  return { flags, values, operands };
}

export function value(parsed: ParsedOptions, key: string): string | undefined {
  return parsed.values.get(key)?.at(-1);
}

export function integer(text: string, minimum = 0): number {
  if (!/^[+]?[0-9]+$/u.test(text)) throw new UsageError(`invalid number '${text}'`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < minimum) throw new UsageError(`invalid number '${text}'`);
  return number;
}

export function requireOperands(operands: readonly string[], minimum = 1, maximum = Infinity): void {
  if (operands.length < minimum) throw new UsageError("missing operand");
  if (operands.length > maximum) throw new UsageError(`extra operand '${operands[maximum]}'`);
}

export function pathOf(context: CommandContext, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  validatePath(path);
  validatePath(context.cwd);
  if (!isAbsolutePath(context.cwd)) throw new FsError("EINVAL", { path: context.cwd, message: "cwd must be absolute" });
  return isAbsolutePath(path) ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {
  context.signal.throwIfAborted();
  await writeBytes(context.stdout, typeof text === "string" ? encoder.encode(text) : text, context.signal);
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  context.signal.throwIfAborted();
  await writeBytes(context.stderr, encoder.encode(`${context.command}: ${error instanceof Error ? error.message : String(error)}\n`), context.signal);
}

export function define(name: string, handler: CommandHandler, failureCode = 1): CommandDefinition {
  return {
    name,
    async execute(context) {
      context.signal.throwIfAborted();
      try { return await handler(context); }
      catch (error) {
        context.signal.throwIfAborted();
        await diagnostic(context, error);
        return { exitCode: error instanceof UsageError ? 2 : failureCode };
      }
    },
  };
}

export async function eachOperand(
  context: CommandContext, operands: readonly string[], operation: (operand: string) => Promise<void>,
): Promise<{ exitCode: number }> {
  let exitCode = 0;
  for (const operand of operands) {
    context.signal.throwIfAborted();
    try { await operation(operand); }
    catch (error) { await diagnostic(context, error); exitCode = 1; }
  }
  return { exitCode };
}

export async function* input(context: CommandContext, name = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (name === "-") {
    yield* readBytes(context.stdin, context.signal);
  } else {
    await assertInputRequirements(context, [name]);
    const path = pathOf(context, name);
    if (context.fs.readStream && context.fs.capabilities.streamingRead !== false) {
      let emitted = false;
      let reading = true;
      try {
        for await (const chunk of readBytes(context.fs.readStream(path, { signal: context.signal }), context.signal)) {
          reading = false;
          if (chunk.byteLength) emitted = true;
          yield chunk;
          reading = true;
        }
        return;
      } catch (error) {
        context.signal.throwIfAborted();
        if (!reading || emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
      }
    }
    if (context.fs.capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
    yield* readBytes({
      async *[Symbol.asyncIterator]() {
        const bytes = await context.fs.readFile(path, { signal: context.signal, maxBytes: bufferLimit });
        context.signal.throwIfAborted();
        if (bytes.byteLength > bufferLimit) throw new FsError("EFBIG", { syscall: "readFile", path });
        yield bytes;
      },
    }, context.signal);
  }
}

export async function assertInputRequirements(context: CommandContext, names: readonly string[]): Promise<void> {
  const files = names.filter(name => name !== "-");
  assertCommandRequirements(context, inputRequirements, [files.length ? "file" : "stdin"]);
  if (!context.fs.capabilitiesFor) return;
  for (const name of files) {
    try {
      const capabilities = await context.fs.capabilitiesFor(pathOf(context, name), { signal: context.signal });
      assertCommandRequirements(context, inputRequirements, ["file"], capabilities);
    } catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS") throw error;
    }
  }
}

export function concatenate(chunks: readonly Uint8Array[], size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function collect(source: ByteSource, signal: AbortSignal, limit = bufferLimit): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > limit) throw new FsError("EFBIG", { message: `buffer limit exceeded (${limit} bytes)` });
    chunks.push(new Uint8Array(chunk));
  }
  return concatenate(chunks, size);
}

export interface Line { readonly bytes: Uint8Array; readonly terminated: boolean }

export async function* lines(source: ByteSource, separator = 10, admit?: (size: number) => void): AsyncGenerator<Line> {
  const pending = new RecordBuffer(bufferLimit);
  try {
    for await (const chunk of source) {
      let start = 0;
      for (let offset = 0; offset < chunk.length; offset++) {
        if (chunk[offset] !== separator) continue;
        yield { bytes: pending.finish(admit, chunk, start, offset), terminated: true };
        start = offset + 1;
      }
      pending.append(chunk, start);
    }
    if (pending.size) yield { bytes: pending.finish(admit), terminated: false };
  } finally { pending.clear(); }
}

export function emptyInput(): ByteSource { return toByteSource(""); }

export function replaceArgument(source: string | Uint8Array, pattern: string, replacement: string): string | Uint8Array {
  if (typeof source === "string") return source.split(pattern).join(replacement);
  const needle = encoder.encode(pattern);
  if (!needle.length) throw new UsageError("replacement string cannot be empty");
  const substituted = encoder.encode(replacement);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (let offset = 0; offset <= source.length - needle.length;) {
    if (needle.every((byte, index) => source[offset + index] === byte)) {
      chunks.push(source.subarray(start, offset), substituted);
      offset += needle.length;
      start = offset;
    } else offset++;
  }
  chunks.push(source.subarray(start));
  return concatenate(chunks);
}

export function escapeBytes(text: string | Uint8Array, zeroOctal = false, bareOctal = false): { bytes: Uint8Array; stop: boolean } {
  if (typeof text === "string") {
    const chunks: Uint8Array[] = [];
    const control: Record<string, number> = { a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92 };
    for (let index = 0; index < text.length;) {
      if (text[index] !== "\\" || index + 1 === text.length) {
        const character = String.fromCodePoint(text.codePointAt(index)!);
        chunks.push(encoder.encode(character)); index += character.length; continue;
      }
      const next = text[index + 1]!;
      if (next === "c") return { bytes: concatenate(chunks), stop: true };
      if (control[next] !== undefined) { chunks.push(Uint8Array.of(control[next])); index += 2; continue; }
      const rest = text.slice(index + 1);
      const octal = zeroOctal ? (bareOctal ? /^(?:0([0-7]{0,3})|([1-7][0-7]{0,2}))/u : /^0([0-7]{0,3})/u).exec(rest) : /^([0-7]{1,3})/u.exec(rest);
      if (octal) { chunks.push(Uint8Array.of(parseInt(octal[1] || octal[2] || "0", 8) & 255)); index += 1 + octal[0].length; continue; }
      const hexadecimal = /^x([0-9a-fA-F]{1,2})/u.exec(rest);
      if (hexadecimal) { chunks.push(Uint8Array.of(parseInt(hexadecimal[1]!, 16))); index += 1 + hexadecimal[0].length; continue; }
      chunks.push(encoder.encode(`\\${next}`)); index += 2;
    }
    return { bytes: concatenate(chunks), stop: false };
  }
  const source = text;
  const bytes = new Uint8Array(source.length);
  const control: Record<number, number> = { 97: 7, 98: 8, 101: 27, 69: 27, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11, 92: 92 };
  let size = 0;
  for (let index = 0; index < source.length;) {
    if (source[index] !== 92 || index + 1 === source.length) { bytes[size++] = source[index++]!; continue; }
    const next = source[index + 1]!;
    if (next === 99) return { bytes: bytes.subarray(0, size), stop: true };
    if (control[next] !== undefined) { bytes[size++] = control[next]; index += 2; continue; }
    if (zeroOctal ? next === 48 || bareOctal && next >= 49 && next <= 55 : next >= 48 && next <= 55) {
      let offset = index + (zeroOctal && next === 48 ? 2 : 1);
      const end = Math.min(source.length, offset + 3);
      let value = 0;
      while (offset < end && source[offset]! >= 48 && source[offset]! <= 55) value = value * 8 + source[offset++]! - 48;
      bytes[size++] = value & 255;
      index = offset;
      continue;
    }
    if (next === 120) {
      let offset = index + 2;
      const end = Math.min(source.length, offset + 2);
      let value = 0;
      while (offset < end) {
        const digit = source[offset]!;
        const number = digit >= 48 && digit <= 57 ? digit - 48 : digit >= 65 && digit <= 70 ? digit - 55 : digit >= 97 && digit <= 102 ? digit - 87 : -1;
        if (number < 0) break;
        value = value * 16 + number;
        offset++;
      }
      if (offset > index + 2) { bytes[size++] = value; index = offset; continue; }
    }
    bytes[size++] = 92;
    bytes[size++] = next;
    index += 2;
  }
  return { bytes: bytes.subarray(0, size), stop: false };
}
