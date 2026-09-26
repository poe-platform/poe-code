import { pathOf } from "safe-bash-query-engine/path";
import { UsageError, publicDiagnosticMessage } from "../diagnostics.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { writeDiagnostic } from "../escaping.js";
import { inputRequirements } from "./portable-requirements.js";
import { RecordBuffer } from "./record-buffer.js";
import { gnuInformation } from "./gnu-information.js";
import { getRuntimeBackingFileSystem } from "../fs/creation-mask.js";
import {
  FsError, readBytes, toByteSource, writeBytes,
  type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler,
} from "../contracts/index.js";

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
export const bufferLimit = 32 * 1024 * 1024;
export const builtInDirectContextExecutors = new WeakSet<CommandHandler>();

export { UsageError } from "safe-bash-contracts/diagnostics";

export interface ParsedOptions {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly operands: string[];
}

const specificationsCache = new Map<string, ReadonlyMap<string, boolean>>();

export function options(
  args: readonly string[], short: string, long: Readonly<Record<string, string | false>> = {},
  stopAtOperand = false, onOperand?: (index: number) => void,
  onValue?: (key: string, index: number, offset: number) => void,
  onOption?: (key: string, value: string | undefined) => void,
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  let specifications = specificationsCache.get(short);
  if (!specifications) {
    const built = new Map<string, boolean>();
    for (let index = 0; index < short.length; index++) {
      const key = short[index]!;
      built.set(key, short[index + 1] === ":");
      if (short[index + 1] === ":") index++;
    }
    specifications = built;
    specificationsCache.set(short, specifications);
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
      const alias = long[name];
      const longValue = typeof alias === "string" && alias.endsWith(":");
      const key = alias === false ? name : longValue ? alias.slice(0, -1) : alias;
      if (!key || (alias !== false && !longValue && !specifications.has(key))) throw new UsageError(`unrecognized option '${argument}'`);
      if (longValue || specifications.get(key)) {
        const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
        if (value === undefined) throw new UsageError(`option '--${name}' requires an argument`);
        onValue?.(key, index, equals >= 0 ? equals + 1 : 0);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
      } else if (equals >= 0) throw new UsageError(`option '--${name}' does not take an argument`);
      flags.add(key);
      onOption?.(key, values.get(key)?.at(-1));
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      const key = argument[offset]!;
      if (!specifications.has(key)) throw new UsageError(`invalid option -- '${key}'`);
      if (specifications.get(key)) {
        const value = argument.slice(offset + 1) || args[++index];
        if (value === undefined) throw new UsageError(`option requires an argument -- '${key}'`);
        onValue?.(key, index, offset + 1 < argument.length ? offset + 1 : 0);
        const list = values.get(key);
        if (list) list.push(value);
        else values.set(key, [value]);
        offset = argument.length;
      }
      flags.add(key);
      onOption?.(key, values.get(key)?.at(-1));
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
export { pathOf } from "safe-bash-query-engine/path";


export function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

export function output(context: CommandContext, text: string | Uint8Array): Promise<void> {
  context.signal.throwIfAborted();
  return writeBytes(context.stdout, typeof text === "string" ? encoder.encode(text) : text, context.signal);
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  context.signal.throwIfAborted();
  await writeDiagnostic(context.stderr, `${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
}

export function define(name: string, handler: CommandHandler, failureCode = 1, usageFailureCode = 2): CommandDefinition {
  const definition: CommandDefinition = {
    name,
    async execute(context) {
      context.signal.throwIfAborted();
      try {
        const infoPromise = gnuInformation(name, context);
        if (infoPromise) {
          const info = await infoPromise;
          if (info) return info;
        }
        return await handler(context);
      }
      catch (error) {
        context.signal.throwIfAborted();
        await diagnostic(context, error);
        return { exitCode: error instanceof UsageError ? usageFailureCode : failureCode };
      }
    },
  };
  builtInDirectContextExecutors.add(definition.execute);
  return definition;
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

export function input(context: CommandContext, name = "-"): ByteSource {
  if (name === "-") {
    if (!context.signal.aborted && (context.stdin as { readonly abortSignal?: AbortSignal }).abortSignal === context.signal) {
      return context.stdin;
    }
    return readBytes(context.stdin, context.signal);
  }
  const backing = getRuntimeBackingFileSystem(context.fs);
  if (
    !context.signal.aborted &&
    backing !== undefined &&
    backing.capabilitiesFor === undefined &&
    context.fs.readStream &&
    context.fs.capabilities.streamingRead !== false &&
    context.fs.capabilities.read !== false &&
    Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
    !Object.prototype.hasOwnProperty.call(backing, "readStream")
  ) {
    const resolvedPath = pathOf(context, name);
    if (resolvedPath !== "/dev" && !resolvedPath.startsWith("/dev/")) {
      return context.fs.readStream(resolvedPath, { signal: context.signal });
    }
  }
  return readBytes({ [Symbol.asyncIterator]() {
    context.signal.throwIfAborted();
    const resolvedPath = pathOf(context, name);
    const backing = getRuntimeBackingFileSystem(context.fs);
    const skipCapsFor = !context.fs.capabilitiesFor || (
      backing?.capabilitiesFor === undefined &&
      resolvedPath !== "/dev" &&
      !resolvedPath.startsWith("/dev/")
    );
    if (skipCapsFor && context.fs.readStream && context.fs.capabilities.streamingRead !== false) {
      assertCommandRequirements(context, inputRequirements, FILE_REQUIREMENT_MODES);
      if (
        backing !== undefined &&
        backing.capabilitiesFor === undefined &&
        Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
        !Object.prototype.hasOwnProperty.call(backing, "readStream")
      ) {
        return context.fs.readStream(resolvedPath, { signal: context.signal })[Symbol.asyncIterator]();
      }
      let iterator: (AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined }) | undefined;
      let closing: Promise<void> | undefined;
      let finished = false;
      let readFailure: { reason: unknown } | undefined;
      const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
        if (!finished) {
          finished = true;
          try { await iterator?.return?.(); }
          catch (error) { if (!readFailure || !Object.is(error, readFailure.reason)) throw error; }
        }
      });
      context.registerCleanup?.(close);
      try {
        context.signal.throwIfAborted();
        iterator = context.fs.readStream(resolvedPath, { signal: context.signal })[Symbol.asyncIterator]();
        if (context.signal.aborted) {
          void close().catch(() => {});
          context.signal.throwIfAborted();
        }
      } catch (error) {
        return fileInputSource(context, name, { [Symbol.asyncIterator]: () => ({ async next() { throw error; } }) });
      }
      const source = { [Symbol.asyncIterator]: () => ({
        tryNextSync() {
          if (finished || closing) return { done: true as const, value: undefined };
          try {
            const result = iterator!.tryNextSync?.();
            if (result?.done) finished = true;
            return result;
          } catch (reason) { readFailure = { reason }; throw reason; }
        },
        async next() {
          if (finished || closing) return { done: true as const, value: undefined };
          try {
            const result = await iterator!.next();
            if (result.done) finished = true;
            return result;
          } catch (reason) { readFailure = { reason }; throw reason; }
        },
        async return() {
          await close();
          return { done: true as const, value: undefined };
        },
      }) };
      const reader = readBytes(source, context.signal) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
      let fallback: AsyncGenerator<Uint8Array> | undefined;
      let emitted = false;
      return {
        abortSignal: context.signal,
        tryNextSync() {
          if (fallback) return undefined;
          const result = reader.tryNextSync();
          if (result && !result.done && result.value.byteLength) emitted = true;
          return result;
        },
        async next() {
          if (fallback) return fallback.next();
          try {
            const result = await reader.next();
            if (!result.done && result.value.byteLength) emitted = true;
            return result;
          } catch (error) {
            context.signal.throwIfAborted();
            if (emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
            fallback = fileInputSource(context, name, false);
            return fallback.next();
          }
        },
        return: (value?: unknown) => (fallback ?? reader).return(value),
        throw: (error?: unknown) => (fallback ?? reader).throw(error),
      };
    }
    return fileInputSource(context, name);
  } }, context.signal);
}

async function* fileInputSource(context: CommandContext, name: string, stream?: ByteSource | false): AsyncGenerator<Uint8Array> {
    context.signal.throwIfAborted();
    await assertInputRequirements(context, [name]);
    const path = pathOf(context, name);
    const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
    if (stream !== false && context.fs.readStream && capabilities.streamingRead !== false) {
      let emitted = false;
      let reading = true;
      try {
        for await (const chunk of readBytes(stream ?? context.fs.readStream(path, { signal: context.signal }), context.signal)) {
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
    if (capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
    yield* readBytes({
      async *[Symbol.asyncIterator]() {
        const bytes = await context.fs.readFile(path, { signal: context.signal, maxBytes: bufferLimit });
        context.signal.throwIfAborted();
        if (bytes.byteLength > bufferLimit) throw new FsError("EFBIG", { syscall: "readFile", path });
        yield bytes;
      },
    }, context.signal);
}

const FILE_REQUIREMENT_MODES = ["file"] as const;
const STDIN_REQUIREMENT_MODES = ["stdin"] as const;

export function assertInputRequirements(context: CommandContext, names: readonly string[]): Promise<void> | void {
  let hasFile = false;
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== "-") { hasFile = true; break; }
  }
  assertCommandRequirements(context, inputRequirements, hasFile ? FILE_REQUIREMENT_MODES : STDIN_REQUIREMENT_MODES);
  if (!hasFile || !context.fs.capabilitiesFor) return;
  if (getRuntimeBackingFileSystem(context.fs)?.capabilitiesFor === undefined) {
    let hasDev = false;
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      if (name === "-") continue;
      const p = pathOf(context, name);
      if (p === "/dev" || p.startsWith("/dev/")) { hasDev = true; break; }
    }
    if (!hasDev) return;
  }
  return assertInputRequirementsAsync(context, names);
}

async function assertInputRequirementsAsync(context: CommandContext, names: readonly string[]): Promise<void> {
  if (!context.fs.capabilitiesFor) return;
  for (const name of names) {
    if (name === "-") continue;
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
      while (start < chunk.length) {
        const offset = chunk.indexOf(separator, start);
        if (offset < 0) break;
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

export function escapeBytes(text: string | Uint8Array, zeroOctal = false, bareOctal = false,
  unicode?: { utf8: boolean; missingDigit: (escape: string) => void }): { bytes: Uint8Array; stop: boolean } {
  if (unicode && typeof text === "string") text = encoder.encode(text);
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
  // C-locale fallback normalizes short escapes to four/eight uppercase digits.
  const bytes = new Uint8Array(source.length * (unicode && !unicode.utf8 ? 3 : 1));
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
    if (unicode && (next === 117 || next === 85)) {
      const digits = next === 117 ? 4 : 8;
      let offset = index + 2;
      const end = Math.min(source.length, offset + digits);
      let value = 0;
      while (offset < end) {
        const digit = source[offset]!;
        const number = digit >= 48 && digit <= 57 ? digit - 48 : digit >= 65 && digit <= 70 ? digit - 55 : digit >= 97 && digit <= 102 ? digit - 87 : -1;
        if (number < 0) break;
        value = value * 16 + number;
        offset++;
      }
      if (offset === index + 2) unicode.missingDigit(String.fromCharCode(next));
      else {
        // Bash discards values outside its signed 32-bit wide-character range.
        if (value < 0x80000000) {
          if (!unicode.utf8 && value > 127) {
            const literal = encoder.encode(`\\${value <= 0xffff ? "u" : "U"}${value.toString(16).toUpperCase().padStart(value <= 0xffff ? 4 : 8, "0")}`);
            bytes.set(literal, size);
            size += literal.length;
          } else if (value < 128) bytes[size++] = value;
          else {
            // Match Bash's byte encoding, including surrogate and extended values.
            const length = value < 0x800 ? 2 : value < 0x10000 ? 3 : value < 0x200000 ? 4 : value < 0x4000000 ? 5 : 6;
            for (let position = length - 1; position > 0; position--) {
              bytes[size + position] = 0x80 | value & 0x3f;
              value = Math.floor(value / 64);
            }
            bytes[size] = (0xff << (8 - length) & 0xff) | value;
            size += length;
          }
        }
        index = offset;
        continue;
      }
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
      unicode?.missingDigit("x");
    }
    bytes[size++] = 92;
    bytes[size++] = next;
    index += 2;
  }
  return { bytes: bytes.subarray(0, size), stop: false };
}
