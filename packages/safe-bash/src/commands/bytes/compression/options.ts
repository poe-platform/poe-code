import { UsageError } from "../../internal.js";

export interface CompressionOptions {
  format: CompressionFormat;
  xzCheck?: number;
  xzIgnoreCheck?: boolean;
  xzFormat?: "auto" | "xz" | "lzma";
  decompress: boolean;
  stdout: boolean;
  keep: boolean;
  force: boolean;
  passthrough?: boolean;
  test: boolean;
  help: boolean;
  quiet: number;
  recursive: boolean;
  small?: boolean;
  level: number;
  extreme?: boolean;
  singleStream?: boolean;
  xzDecompressMemory?: number;
  suffix?: string;
  zstd?: ZstdOptions;
  excludeCompressed?: boolean;
  asyncIO?: boolean;
  operands: string[];
}

export interface ZstdOptions {
  check: boolean;
  literals: number;
  row: number;
  window: number;
  streamSize?: number;
  sizeHint: number;
}

export const profiles = [
  { format: "gzip", names: ["gzip", "gunzip", "zcat"], suffix: ".gz", level: 6, minimumLevel: 1, keep: false },
  { format: "bzip2", names: ["bzip2", "bunzip2", "bzcat"], suffix: ".bz2", level: 9, minimumLevel: 1, keep: false },
  { format: "xz", names: ["xz", "unxz", "xzcat"], suffix: ".xz", level: 3, minimumLevel: 0, keep: false },
  { format: "zstd", names: ["zstd", "unzstd", "zstdcat"], suffix: ".zst", level: 3, minimumLevel: 1, keep: true },
] as const;

export type CompressionFormat = typeof profiles[number]["format"];

const aliases: Readonly<Record<string, string>> = {
  stdout: "c", "to-stdout": "c", decompress: "d", uncompress: "d", keep: "k",
  force: "f", test: "t", best: "9", "no-name": "n", help: "h", quiet: "q", recursive: "r", compress: "z", small: "s",
};

export function parseOptions(command: string, args: readonly string[]): CompressionOptions {
  const profile = profiles.find(value => value.names.some(name => name === command));
  if (!profile) throw new UsageError(`unknown compression command '${command}'`);
  const result: CompressionOptions = {
    format: profile.format,
    decompress: command !== profile.names[0], stdout: command === profile.names[2], keep: profile.keep,
    force: false, test: false, help: false, quiet: 0, recursive: false, level: profile.level, operands: [],
    ...(command === "zstdcat" ? { passthrough: true } : {}),
    ...(profile.format === "zstd" ? { zstd: { check: true, literals: 0, row: 0, window: 0, sizeHint: 0 } } : {}),
  };
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      result.operands.push(argument);
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    if (result.zstd && argument.startsWith("--")) {
      const equal = argument.indexOf("=");
      const name = equal < 0 ? argument.slice(2) : argument.slice(2, equal);
      const value = equal < 0 ? undefined : argument.slice(equal + 1);
      if (["threads", "format", "stream-size", "size-hint", "long", "auto-threads"].includes(name)) {
        const supplied = value ?? (name === "long" ? "27" : args[++index]);
        if (name === "format") {
          if (supplied !== "zstd") throw new UsageError("only --format=zstd is supported");
        } else if (name === "auto-threads") {
          if (supplied !== "physical" && supplied !== "logical") throw new UsageError("invalid automatic thread selection");
        } else {
          if (!supplied || ![...supplied].every(character => character >= "0" && character <= "9") || !Number.isSafeInteger(Number(supplied))) throw new UsageError(`invalid --${name} value`);
          const number = Number(supplied);
          if (name === "threads" && number !== 1) throw new UsageError("only --threads=1 is supported by the single-threaded Zstandard codec");
          if (name === "long") {
            if (number < 10 || number > 23) throw new UsageError("long-distance matching requires a window log from 10 through 23 under the codec window limit");
            result.zstd.window = number;
          }
          if (name === "stream-size") result.zstd.streamSize = number;
          if (name === "size-hint") {
            if (number > 0x7fffffff) throw new UsageError("size hint exceeds the codec parameter limit");
            result.zstd.sizeHint = number;
          }
        }
        continue;
      }
      if (value === undefined) {
        if (["no-progress", "single-thread", "no-dictID", "no-sparse", "ultra"].includes(name)) continue;
        if (name === "asyncio" || name === "no-asyncio") { result.asyncIO = name === "asyncio"; continue; }
        if (name === "check" || name === "no-check") { result.zstd.check = name === "check"; continue; }
        if (name === "pass-through" || name === "no-pass-through") { result.passthrough = name === "pass-through"; continue; }
        if (name === "compress-literals" || name === "no-compress-literals") { result.zstd.literals = name === "compress-literals" ? 1 : 2; continue; }
        if (name === "row-match-finder" || name === "no-row-match-finder") { result.zstd.row = name === "row-match-finder" ? 1 : 2; continue; }
        if (name === "exclude-compressed") { result.excludeCompressed = true; continue; }
        if (["adapt", "rsyncable", "progress"].includes(name)) throw new UsageError(`--${name} is unsupported by the bounded streaming Zstandard frontend`);
      }
    }
    if (profile.format === "zstd" && (argument === "--fast" || argument.startsWith("--fast="))) {
      const acceleration = argument === "--fast" ? "1" : argument.slice("--fast=".length);
      if (!acceleration || ![...acceleration].every(character => character >= "0" && character <= "9")
        || !Number.isSafeInteger(Number(acceleration)) || Number(acceleration) < 1) {
        throw new UsageError(`invalid fast acceleration '${acceleration}'`);
      }
      result.level = -Number(acceleration);
      continue;
    }
    if (profile.format === "xz") {
      if (argument === "--memlimit-decompress" || argument.startsWith("--memlimit-decompress=")
        || argument === "--memlimit-mt-decompress" || argument.startsWith("--memlimit-mt-decompress=")) {
        const equal = argument.indexOf("=");
        const name = equal < 0 ? argument.slice(2) : argument.slice(2, equal);
        const value = equal < 0 ? args[++index] : argument.slice(equal + 1);
        const memory = parseXzMemory(value);
        // The codec is single-threaded: the MT soft limit never applies.
        if (name === "memlimit-decompress") result.xzDecompressMemory = memory;
        continue;
      }
      if (argument === "--ignore-check") { result.xzIgnoreCheck = true; continue; }
      if (argument === "--check" || argument.startsWith("--check=")) {
        result.xzCheck = parseXzCheck(argument === "--check" ? args[++index] : argument.slice("--check=".length));
        continue;
      }
      if (argument === "--single-stream") { result.singleStream = true; continue; }
      // The frontend already writes dense output and emits no XZ warnings.
      if (argument === "--no-sparse" || argument === "--no-warn") continue;
      if (argument === "--format" || argument.startsWith("--format=")) {
        const format = argument === "--format" ? args[++index] : argument.slice("--format=".length);
        if (format !== "auto" && format !== "xz" && format !== "lzma") throw new UsageError("only --format=auto, --format=xz and --format=lzma are supported by the XZ frontend");
        result.xzFormat = format;
        continue;
      }
      if (argument === "--compress") { result.decompress = false; result.test = false; continue; }
      if (argument === "--extreme") { result.extreme = true; continue; }
      if (argument === "--threads" || argument.startsWith("--threads=")) {
        const threads = argument === "--threads" ? args[++index] : argument.slice("--threads=".length);
        if (threads !== "1") throw new UsageError("only --threads=1 is supported by the single-threaded XZ codec");
        continue;
      }
    }
    if (profile.format === "gzip" && (argument === "--suffix" || argument.startsWith("--suffix="))) {
      const suffix = argument === "--suffix" ? args[++index] : argument.slice("--suffix=".length);
      if (suffix === undefined) throw new UsageError("option '--suffix' requires an argument");
      result.suffix = suffix;
      continue;
    }
    const flags = argument === "--fast" ? String(profile.minimumLevel)
      : argument.startsWith("--") ? aliases[argument.slice(2)] : argument.slice(1);
    if (!flags) throw new UsageError(`unrecognized option '${argument}'`);
    for (let offset = 0; offset < flags.length; offset++) {
      const flag = flags[offset]!;
      if (profile.format === "zstd" && flag >= "0" && flag <= "9") {
        let end = offset + 1;
        while (end < flags.length && flags[end]! >= "0" && flags[end]! <= "9") end++;
        result.level = Number(flags.slice(offset, end));
        if (result.level === 0) throw new UsageError("invalid option -- '0'");
        offset = end - 1;
        continue;
      }
      switch (flag) {
        case "C": {
          if (profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          result.xzCheck = parseXzCheck(flags.slice(offset + 1) || args[++index]);
          offset = flags.length;
          break;
        }
        case "F": {
          if (profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          const format = flags.slice(offset + 1) || args[++index];
          if (format !== "auto" && format !== "xz" && format !== "lzma") throw new UsageError("only --format=auto, --format=xz and --format=lzma are supported by the XZ frontend");
          result.xzFormat = format;
          offset = flags.length;
          break;
        }
        case "e":
          if (profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          result.extreme = true;
          break;
        case "T": {
          if (profile.format !== "xz" && profile.format !== "zstd") throw new UsageError(`invalid option -- '${flag}'`);
          const threads = flags.slice(offset + 1) || args[++index];
          if (threads !== "1") throw new UsageError(`only --threads=1 is supported by the single-threaded ${profile.format} codec`);
          offset = flags.length;
          break;
        }
        case "S": {
          if (profile.format !== "gzip") throw new UsageError(`invalid option -- '${flag}'`);
          const suffix = flags.slice(offset + 1) || args[++index];
          if (suffix === undefined) throw new UsageError("option '-S' requires an argument");
          result.suffix = suffix;
          offset = flags.length;
          break;
        }
        case "c": result.stdout = true; break;
        case "d": result.decompress = true; break;
        case "z":
          if (profile.format !== "bzip2") throw new UsageError(`invalid option -- '${flag}'`);
          result.decompress = false;
          break;
        case "s":
          if (profile.format !== "bzip2") throw new UsageError(`invalid option -- '${flag}'`);
          result.small = true;
          break;
        case "k": result.keep = true; break;
        case "f": result.force = true; break;
        case "t": result.test = true; result.decompress = true; break;
        case "h": result.help = true; break;
        case "q":
          if (profile.format !== "zstd" && profile.format !== "gzip" && profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          result.quiet = profile.format === "gzip" ? 1 : result.quiet + 1;
          break;
        case "r":
          if (profile.format !== "gzip") throw new UsageError(`invalid option -- '${flag}'`);
          result.recursive = true;
          break;
        case "n":
          if (profile.format !== "gzip") throw new UsageError(`invalid option -- '${flag}'`);
          break;
        default:
          if (flag >= String(profile.minimumLevel) && flag <= "9") result.level = Number(flag);
          else throw new UsageError(`invalid option -- '${flag}'`);
      }
    }
  }
  if (profile.format === "zstd" && (!Number.isSafeInteger(result.level) || result.level < 1 || result.level > 9)) {
    throw new UsageError(`unsupported compression level ${result.level}; the bounded Zstandard codec supports only levels 1 through 9 (fast mode is unsupported)`);
  }
  if (result.suffix === "" && !result.decompress) throw new UsageError("invalid suffix ''");
  if (result.small && !result.decompress) result.level = Math.min(result.level, 2);
  if (result.xzFormat === "lzma" && !result.decompress && result.xzCheck !== undefined && result.xzCheck !== 0) {
    throw new UsageError("the LZMA format supports only --check=none");
  }
  if (!result.operands.length) result.operands.push("-");
  return result;
}

/** Absolute XZ memory limits; host RAM percentages have no virtual-shell meaning. */
function parseXzMemory(value: string | undefined): number {
  if (!value) throw new UsageError("memory limit requires a value");
  let end = 0;
  while (end < value.length && value[end]! >= "0" && value[end]! <= "9") end++;
  const suffix = value.slice(end);
  const units = ["", "k", "m", "g"];
  const unit = suffix.toLowerCase();
  const power = units.indexOf(unit.endsWith("ib") ? unit.slice(0, -2)
    : unit.endsWith("b") || unit.endsWith("i") ? unit.slice(0, -1) : unit);
  if (!end || power < 0 || (suffix && power === 0)) throw new UsageError(`invalid memory limit '${value}'`);
  const bytes = BigInt(value.slice(0, end)) * 1024n ** BigInt(power);
  if (bytes > 0xffffffffffffffffn) throw new UsageError("memory limit exceeds the XZ uint64 limit");
  // Zero disables the caller limit, never the codec's existing allocation ceiling.
  return bytes === 0n ? 64 * 1024 * 1024 : Number(bytes > 67108864n ? 67108864n : bytes);
}

function parseXzCheck(value: string | undefined): number {
  const checks: Readonly<Record<string, number>> = { none: 0, crc32: 1, crc64: 4, sha256: 10 };
  const check = value !== undefined && Object.hasOwn(checks, value) ? checks[value] : undefined;
  if (check === undefined) throw new UsageError(`unsupported XZ integrity check '${value ?? ""}'`);
  return check;
}
