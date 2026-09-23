import { UsageError } from "../../internal.js";

export interface CompressionOptions {
  format: CompressionFormat;
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
  suffix?: string;
  operands: string[];
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
    passthrough: command === "zstdcat",
  };
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) {
      result.operands.push(argument);
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    if (profile.format === "xz") {
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
      switch (flag) {
        case "e":
          if (profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          result.extreme = true;
          break;
        case "T": {
          if (profile.format !== "xz") throw new UsageError(`invalid option -- '${flag}'`);
          const threads = flags.slice(offset + 1) || args[++index];
          if (threads !== "1") throw new UsageError("only --threads=1 is supported by the single-threaded XZ codec");
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
          if (profile.format !== "zstd" && profile.format !== "gzip") throw new UsageError(`invalid option -- '${flag}'`);
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
  if (result.suffix === "" && !result.decompress) throw new UsageError("invalid suffix ''");
  if (result.small && !result.decompress) result.level = Math.min(result.level, 2);
  if (!result.operands.length) result.operands.push("-");
  return result;
}
