import { blockSize, UsageError, type Format } from "./format.js";
import type { Budget } from "./budget.js";

export interface Arguments {
  readonly operands: readonly string[];
  readonly all: boolean;
  readonly summarize: boolean;
  readonly total: boolean;
  readonly apparent: boolean;
  readonly countLinks: boolean;
  readonly nullOutput: boolean;
  readonly depth: number;
  readonly format: Format;
  readonly help: boolean;
}

export function parse(budget: Budget): Arguments {
  const { args, env } = budget.context;
  budget.check(args.length, budget.limits.maxArguments, "argument count");
  let bytes = 0;
  for (const argument of args) {
    budget.check(argument.length, budget.limits.maxArgumentBytes - bytes, "argument bytes");
    bytes += Buffer.byteLength(argument);
    budget.check(bytes, budget.limits.maxArgumentBytes, "argument bytes");
    budget.step(argument.length + 1);
    if (argument.includes("\0")) throw new UsageError("NUL in argument");
  }
  const operands: string[] = [];
  let all = false, summarize = false, total = false, apparent = false, countLinks = false, nullOutput = false, help = false;
  let depth: number | undefined;
  let format: Format | undefined;
  let options = true;
  const valueOption = (flag: string, value: string): void => {
    if (flag === "B" || flag === "block-size") { format = blockSize(value); return; }
    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError(`invalid maximum depth '${value}'`);
    depth = Number(value);
  };
  const flagOption = (flag: string): void => {
    switch (flag) {
      case "a": case "all": all = true; break;
      case "s": case "summarize": summarize = true; break;
      case "c": case "total": total = true; break;
      case "h": case "human-readable": format = blockSize("human-readable"); break;
      case "k": format = blockSize("1024"); break;
      case "m": format = blockSize("1048576"); break;
      case "b": case "bytes": apparent = true; format = blockSize("1"); break;
      case "apparent-size": apparent = true; break;
      case "l": case "count-links": countLinks = true; break;
      case "0": case "null": nullOutput = true; break;
      case "help": help = true; break;
      default: throw new UsageError(`unrecognized option '${flag.length === 1 ? "-" : "--"}${flag}'`);
    }
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (options && argument === "--") { options = false; continue; }
    if (!options || argument === "-" || !argument.startsWith("-")) { operands.push(argument); continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const flag = argument.slice(2, equals < 0 ? undefined : equals);
      if (flag === "block-size" || flag === "max-depth") {
        const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
        if (value === undefined) throw new UsageError(`option '--${flag}' requires an argument`);
        valueOption(flag, value);
      } else {
        if (equals >= 0) throw new UsageError(`option '--${flag}' does not accept an argument`);
        flagOption(flag);
      }
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (flag === "B" || flag === "d") {
          const value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new UsageError(`option '-${flag}' requires an argument`);
          valueOption(flag, value);
          break;
        }
        flagOption(flag);
      }
    }
  }
  if (all && summarize) throw new UsageError("cannot combine --all and --summarize");
  if (summarize && depth !== undefined && depth !== 0) throw new UsageError("--summarize conflicts with --max-depth");
  if (!format) {
    let selected: string | undefined;
    for (const name of ["DU_BLOCK_SIZE", "BLOCK_SIZE", "BLOCKSIZE"]) {
      if (Object.hasOwn(env, name)) { selected = env[name]; break; }
    }
    if (selected !== undefined) {
      budget.check(selected.length, budget.limits.maxArgumentBytes - bytes, "environment bytes");
      budget.check(Buffer.byteLength(selected), budget.limits.maxArgumentBytes - bytes, "environment bytes");
      budget.step(selected.length + 1);
      try { format = blockSize(selected); }
      catch (error) {
        if (!(error instanceof UsageError)) throw error;
        format = blockSize(Object.hasOwn(env, "POSIXLY_CORRECT") ? "512" : "1024");
      }
    } else format = blockSize(Object.hasOwn(env, "POSIXLY_CORRECT") ? "512" : "1024");
  }
  if (operands.length === 0) operands.push(".");
  for (const operand of operands) budget.text(operand);
  return { operands, all, summarize, total, apparent, countLinks, nullOutput, depth: summarize ? 0 : depth ?? Number.MAX_SAFE_INTEGER, format, help };
}

export const helpText = `Usage: du [OPTION]... [--] [FILE]...
Report provider allocation; unknown allocation is an error, never logical size.
  -a, --all                 report files as well as directories
  -s, --summarize           report each operand only
  -c, --total               report a complete grand total
  -h, --human-readable      upward-rounded base-1024 units
  -k / -m                  report 1024 / 1048576 byte units
  -B, --block-size=SIZE     positive integer with optional K/M/G/T/P suffix
  -b, --bytes               apparent size in bytes
      --apparent-size      file/link lengths, zero directory contribution
  -d, --max-depth=N         reporting depth only; traversal still bounded
  -l, --count-links         count every non-directory alias
  -0, --null                terminate records with NUL instead of newline
No symlink following, content reads, or mutation calls by this command.
Incomplete totals are suppressed. Unknown identities count independently.
Traversal and output limits apply; adapters may have their own side effects.
`;
