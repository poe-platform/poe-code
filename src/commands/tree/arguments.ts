import { UsageError, type WalkBudget } from "./io.js";
import { compile, type Pattern } from "./pattern.js";

export interface Arguments {
  all: boolean;
  directories: boolean;
  follow: boolean;
  full: boolean;
  indent: boolean;
  json: boolean;
  report: boolean;
  reverse: boolean;
  dirsFirst: boolean;
  charset: "ASCII" | "UTF-8";
  level: number | undefined;
  include: Pattern[];
  exclude: Pattern[];
  operands: string[];
  help: boolean;
  version: boolean;
}

export function parse(args: readonly string[], budget: WalkBudget): Arguments {
  budget.check(args.length, budget.limits.maxArguments, "argument count");
  let bytes = 0;
  for (const arg of args) {
    budget.check(bytes + arg.length, budget.limits.maxArgumentBytes, "argument");
    budget.check(bytes += Buffer.byteLength(arg), budget.limits.maxArgumentBytes, "argument");
    if (arg.includes("\0")) throw new UsageError("arguments must not contain NUL");
    if (/[\ud800-\udfff]/u.test(arg)) throw new UsageError("arguments must be well-formed Unicode");
  }
  const result: Arguments = { all: false, directories: false, follow: false, full: false, indent: true,
    json: false, report: true, reverse: false, dirsFirst: false, charset: "ASCII", level: undefined,
    include: [], exclude: [], operands: [], help: false, version: false };
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const value = (option: string, attached: string | undefined): string => {
      if (attached !== undefined) return attached;
      if (++index >= args.length) throw new UsageError(`${option} requires a value`);
      return args[index]!;
    };
    if (ended || !arg.startsWith("-") || arg === "-") { result.operands.push(arg); continue; }
    if (arg === "--") { ended = true; continue; }
    if (arg === "--noreport") { result.report = false; continue; }
    if (arg === "--dirsfirst") { result.dirsFirst = true; continue; }
    if (arg === "--help") { result.help = true; continue; }
    if (arg === "--version") { result.version = true; continue; }
    if (arg === "--charset" || arg.startsWith("--charset=")) {
      const charset = value("--charset", arg.startsWith("--charset=") ? arg.slice(10) : undefined).toUpperCase();
      if (charset !== "ASCII" && charset !== "UTF-8") throw new UsageError("supported charsets: ASCII, UTF-8");
      result.charset = charset; continue;
    }
    if (arg.startsWith("--")) throw new UsageError(`unsupported option: ${arg}`);
    for (let offset = 1; offset < arg.length; offset++) {
      const flag = arg[offset]!;
      switch (flag) {
        case "a": result.all = true; break;
        case "d": result.directories = true; break;
        case "l": result.follow = true; break;
        case "f": result.full = true; break;
        case "i": result.indent = false; break;
        case "J": result.json = true; break;
        case "r": result.reverse = true; break;
        case "n": break;
        case "L": case "P": case "I": {
          const argument = value(`-${flag}`, offset + 1 < arg.length ? arg.slice(offset + 1) : undefined);
          if (flag === "L") {
            const level = Number(argument);
            if (!/^[0-9]+$/u.test(argument) || !Number.isSafeInteger(level) || level < 1 || level > budget.limits.maxDepth) {
              throw new UsageError(`-L must be between 1 and ${budget.limits.maxDepth}`);
            }
            result.level = level;
          } else (flag === "P" ? result.include : result.exclude).push(compile(argument, budget));
          offset = arg.length; break;
        }
        default: throw new UsageError(`unsupported option: -${flag}`);
      }
    }
  }
  if (!result.operands.length) result.operands.push(".");
  for (const operand of result.operands) if (operand === "") throw new UsageError("empty path operand");
  return result;
}

export const help = `Usage: tree [-adlfirnJ] [-L depth] [-P pattern] [-I pattern] [--dirsfirst]
            [--charset=ASCII|UTF-8] [--noreport] [--] [path ...]
Virtual filesystem tree; no native processes or implicit host access.
Default: visible entries, no symlink traversal, C/UTF-8-byte name order,
ASCII branches, escaped filenames. -l follows directory links; ancestor
cycles are skipped. -P includes files; -I excludes files and directories.
Basename patterns: *, ?, bracket ranges, | alternatives, backslash literals.
-J emits JSON; -i removes text branches or JSON formatting whitespace.
Unsupported options and path/globstar patterns are rejected before VFS I/O.
`;
