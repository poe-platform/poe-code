import { UsageError } from "../../internal.js";

export interface CompressionOptions {
  decompress: boolean;
  stdout: boolean;
  keep: boolean;
  force: boolean;
  test: boolean;
  help: boolean;
  level: number;
  operands: string[];
}

const aliases: Readonly<Record<string, string>> = {
  stdout: "c", "to-stdout": "c", decompress: "d", uncompress: "d", keep: "k",
  force: "f", test: "t", fast: "1", best: "9", "no-name": "n", help: "h",
};

export function parseOptions(command: string, args: readonly string[]): CompressionOptions {
  const result: CompressionOptions = {
    decompress: command !== "gzip", stdout: command === "zcat", keep: false,
    force: false, test: false, help: false, level: 6, operands: [],
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
        case "n": break;
        default:
          if (/^[1-9]$/u.test(flag)) result.level = Number(flag);
          else throw new UsageError(`invalid option -- '${flag}'`);
      }
    }
  }
  if (!result.operands.length) result.operands.push("-");
  return result;
}
