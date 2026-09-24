import { PublicDiagnostic } from "../../diagnostics.js";
export interface SplitLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxFiles: number;
  readonly maxBufferBytes: number;
  readonly maxChunkBytes: number;
  readonly maxArgumentBytes: number;
  readonly maxSuffixLength: number;
  readonly maxSteps: number;
}

export interface SplitCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<SplitLimits>;
}

export function settings(options: SplitCommandsOptions): SplitLimits {
  const limits: SplitLimits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxFiles: Infinity, maxBufferBytes: 8 * 1024 * 1024, maxChunkBytes: 64 * 1024,
    maxArgumentBytes: Infinity, maxSuffixLength: Infinity, maxSteps: Infinity,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid split limit: ${name}`);
  }
  return limits;
}

export interface SplitArguments {
  readonly mode: "lines" | "bytes" | "line-bytes" | "chunks";
  readonly size: number;
  readonly chunkMode: "bytes" | "lines" | "round-robin";
  readonly selectedChunk: number;
  readonly input: string;
  readonly prefix: string;
  readonly alphabet: string;
  readonly suffixLength: number;
  readonly automatic: boolean;
  readonly numericStart: string;
  readonly additionalSuffix: string;
  readonly separator: number;
  readonly elideEmpty: boolean;
}

function number(text: string, label: string, units = false, zero = false): number {
  const match = /^[\t\n\v\f\r ]*\+?([0-9]*)([a-zA-Z]*)$/u.exec(text);
  if (!match || (!match[1] && (!units || !match[2] || text !== match[2]))) throw new PublicDiagnostic(`invalid ${label}: '${text}'`);
  const suffix = match[2]!;
  let multiplier = 1;
  if (suffix) {
    if (!units) throw new PublicDiagnostic(`invalid ${label}: '${text}'`);
    if (suffix === "b") multiplier = 512;
    else {
      const unit = /^([kKmMGTPEZYRQ])(?:(i?B))?$/u.exec(suffix);
      if (!unit) throw new PublicDiagnostic(`invalid ${label}: '${text}'`);
      const exponent = "KMGTPEZYRQ".indexOf(unit[1]!.toUpperCase()) + 1;
      multiplier = (unit[2] === "B" ? 1000 : 1024) ** exponent;
    }
  }
  const value = Number(match[1] || "1") * multiplier;
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new PublicDiagnostic(`invalid ${label}: '${text}'`);
  return value;
}

export function parseArguments(args: readonly string[], limits: SplitLimits): SplitArguments {
  if (args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > limits.maxArgumentBytes) {
    throw new PublicDiagnostic("split argument limit exceeded");
  }
  let mode: SplitArguments["mode"] | undefined;
  let size = 1000;
  let chunkMode: SplitArguments["chunkMode"] = "bytes";
  let selectedChunk = 0;
  let suffixLength = 0;
  let alphabet = "abcdefghijklmnopqrstuvwxyz";
  let numericStart: string | undefined;
  let additionalSuffix = "";
  let separator = 10;
  let elideEmpty = false;
  const operands: string[] = [];
  let ended = false;
  const apply = (option: string, value?: string): void => {
    if (option === "d" || option === "x") {
      alphabet = option === "d" ? "0123456789" : "0123456789abcdef";
      if (value !== undefined) {
        if ([...value.toLowerCase()].some(digit => !alphabet.includes(digit))) throw new PublicDiagnostic(`invalid start value for numerical suffix: '${value}'`);
        numericStart = BigInt(option === "x" ? `0x${value || "0"}` : value || "0").toString(alphabet.length);
      }
    } else if (option === "a") suffixLength = number(value!, "suffix length", false, true);
    else if (option === "e") elideEmpty = true;
    else if (option === "t") {
      const bytes = Buffer.from(value === "\\0" ? "\0" : value!);
      if (bytes.length !== 1) throw new PublicDiagnostic("separator must be exactly one byte");
      separator = bytes[0]!;
    }
    else if (option === "additional-suffix") {
      if (value!.includes("/") || value!.includes("\0")) throw new PublicDiagnostic("invalid additional suffix: contains directory separator or NUL");
      additionalSuffix = value!;
    } else {
      if (mode) throw new PublicDiagnostic("cannot split in more than one way");
      mode = option === "l" ? "lines" : option === "b" ? "bytes" : option === "n" ? "chunks" : "line-bytes";
      if (option === "n") {
        const parts = value!.split("/");
        if (parts[0] === "l" || parts[0] === "r") chunkMode = parts.shift() === "l" ? "lines" : "round-robin";
        if (parts.length < 1 || parts.length > 2) throw new PublicDiagnostic(`invalid number of chunks: '${value}'`);
        size = number(parts[parts.length - 1]!, "number of chunks");
        if (parts.length === 2) {
          selectedChunk = number(parts[0]!, "chunk number");
          if (selectedChunk > size) throw new PublicDiagnostic(`invalid chunk number: '${value}'`);
        }
        return;
      }
      size = number(value!, option === "l" ? "number of lines" : option === "n" ? "number of chunks" : "number of bytes", option === "b" || option === "C");
    }
  };
  const long: Readonly<Record<string, string>> = {
    lines: "l", bytes: "b", "line-bytes": "C", "suffix-length": "a",
    "numeric-suffixes": "d", "additional-suffix": "additional-suffix",
    "hex-suffixes": "x", separator: "t", "elide-empty-files": "e", number: "n",
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) { operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const option = long[name];
      if (!option) throw new PublicDiagnostic(`unrecognized option '${argument}'`);
      if (option === "e" && equals >= 0) throw new PublicDiagnostic(`option '--${name}' doesn't allow an argument`);
      const optional = option === "d" || option === "x" || option === "e";
      const value = equals < 0 ? (optional ? undefined : args[++index]) : argument.slice(equals + 1);
      if (!optional && value === undefined) throw new PublicDiagnostic(`option '--${name}' requires an argument`);
      apply(option, value);
    } else if ([...argument.slice(1)].every(digit => digit >= "0" && digit <= "9")) {
      apply("l", argument.slice(1));
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const option = argument[offset]!;
        if (!"lbaCdxetn".includes(option)) throw new PublicDiagnostic(`invalid option -- '${option}'`);
        if (option === "d" || option === "x" || option === "e") apply(option);
        else {
          const value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new PublicDiagnostic(`option requires an argument -- '${option}'`);
          apply(option, value);
          break;
        }
      }
    }
  }
  if (operands.length > 2) throw new PublicDiagnostic(`extra operand '${operands[2]}'`);
  let requiredSuffixLength = 1;
  if (mode === "chunks") {
    let capacity = alphabet.length;
    while (capacity < size) {
      capacity *= alphabet.length;
      requiredSuffixLength++;
    }
    if (suffixLength && suffixLength < requiredSuffixLength) {
      throw new PublicDiagnostic(`the suffix length needs to be at least ${requiredSuffixLength}`);
    }
  }
  const automatic = suffixLength === 0 && numericStart === undefined && mode !== "chunks";
  suffixLength ||= Math.max(2, requiredSuffixLength);
  if (suffixLength > limits.maxSuffixLength) throw new PublicDiagnostic("split suffix length limit exceeded");
  if (numericStart !== undefined && numericStart.length > suffixLength) throw new PublicDiagnostic("numerical suffix start value is too large for the suffix length");
  if (mode === "line-bytes" && size > limits.maxBufferBytes) throw new PublicDiagnostic("split line-bytes window exceeds buffer limit");
  if (mode === "chunks" && !elideEmpty && !selectedChunk && size > limits.maxFiles) throw new PublicDiagnostic("split file limit exceeded");
  return {
    mode: mode ?? "lines", size, chunkMode, selectedChunk, input: operands[0] ?? "-", prefix: operands[1] ?? "x",
    alphabet,
    suffixLength, automatic,
    numericStart: numericStart ?? "0", additionalSuffix, separator, elideEmpty,
  };
}
