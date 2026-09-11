import { UsageError } from "../../internal.js";

export interface CompressionOptions {
  format: CompressionFormat;
  decompress: boolean;
  stdout: boolean;
  keep: boolean;
  force: boolean;
  test: boolean;
  help: boolean;
  level: number;
  operands: string[];
}

export const profiles = [
  { format: "gzip", names: ["gzip", "gunzip", "zcat"], suffix: ".gz", level: 6, keep: false },
  { format: "bzip2", names: ["bzip2", "bunzip2", "bzcat"], suffix: ".bz2", level: 9, keep: false },
  { format: "xz", names: ["xz", "unxz", "xzcat"], suffix: ".xz", level: 3, keep: false },
  { format: "zstd", names: ["zstd", "unzstd", "zstdcat"], suffix: ".zst", level: 3, keep: true },
] as const;

export type CompressionFormat = typeof profiles[number]["format"];

const aliases: Readonly<Record<string, string>> = {
  stdout: "c", "to-stdout": "c", decompress: "d", uncompress: "d", keep: "k",
  force: "f", test: "t", fast: "1", best: "9", "no-name": "n", help: "h",
};

export function parseOptions(command: string, args: readonly string[]): CompressionOptions {
  const profile = profiles.find(value => value.names.some(name => name === command));
  if (!profile) throw new UsageError(`unknown compression command '${command}'`);
  const result: CompressionOptions = {
    format: profile.format,
    decompress: command !== profile.names[0], stdout: command === profile.names[2], keep: profile.keep,
    force: false, test: false, help: false, level: profile.level, operands: [],
  };
  let ended = false;
  for (const argument of args) {
    if (ended || argument === "-" || !argument.startsWith("-")) {
      result.operands.push(argument);
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    const flags = argument.startsWith("--") ? aliases[argument.slice(2)] : argument.slice(1);
    if (!flags) throw new UsageError(`unrecognized option '${argument}'`);
    for (const flag of flags) {
      switch (flag) {
        case "c": result.stdout = true; break;
        case "d": result.decompress = true; break;
        case "k": result.keep = true; break;
        case "f": result.force = true; break;
        case "t": result.test = true; result.decompress = true; break;
        case "h": result.help = true; break;
        case "n":
          if (profile.format !== "gzip") throw new UsageError(`invalid option -- '${flag}'`);
          break;
        default:
          if (/^[1-9]$/u.test(flag)) result.level = Number(flag);
          else throw new UsageError(`invalid option -- '${flag}'`);
      }
    }
  }
  if (!result.operands.length) result.operands.push("-");
  return result;
}
