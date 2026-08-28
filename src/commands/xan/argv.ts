import { resolvePath } from "../../contracts/path.js";
import { Budget, XanError } from "./budget.js";
import { boundedSort } from "./sort.js";

export type Subcommand = "headers" | "count" | "select" | "slice";
export interface Arguments {
  command: Subcommand;
  inputs: string[];
  output?: string;
  delimiter?: number;
  noHeaders: boolean;
  justNames: boolean;
  csv: boolean;
  help: boolean;
  selection: string;
  start: bigint;
  end?: bigint;
  indices?: bigint[];
  last?: number;
}
const unsignedMax = (1n << 64n) - 1n;
export class DeserializationError extends XanError {}
export class UsageError extends XanError {}
const headersUsage = "Usage:\n    xan headers [options] [<input>...]\n    xan h [options] [<input>...]\n\n";
export async function unsigned(text: string, option: string, budget: Budget): Promise<bigint> {
  let offset = text.startsWith("+") ? 1 : 0;
  let value = 0n;
  const invalid = (): never => { throw new DeserializationError(`Could not deserialize '${text}' to u64 for '${option}'.`); };
  if (offset === text.length) invalid();
  for (; offset < text.length; offset++) {
    budget.work();
    const digit = text.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) invalid();
    value = value * 10n + BigInt(digit);
    if (value > unsignedMax) invalid();
    if ((offset & 1023) === 0) await budget.checkpoint();
  }
  return value;
}
export function checkedAdd(left: bigint, right: bigint): bigint {
  const value = left + right;
  if (value > unsignedMax) throw new XanError("unsigned arithmetic overflow");
  return value;
}
export function inferDelimiter(path: string): number {
  if (/\.(tsv|tab)$/u.test(path)) return 9;
  if (/\.(ssv|scsv)$/u.test(path)) return 59;
  if (/\.psv$/u.test(path)) return 124;
  return 44;
}
const shortOptions: Record<string, string> = { h: "help", o: "output", d: "delimiter", n: "no-headers", j: "just-names", s: "start", e: "end", l: "len", i: "index", I: "indices", L: "last" };
const switches = new Set(["help", "no-headers", "just-names", "csv"]);
const common = ["help", "output", "delimiter"];
const allowed: Record<Subcommand, Set<string>> = {
  headers: new Set([...common, "just-names", "csv", "start", "color"]),
  count: new Set([...common, "no-headers"]),
  select: new Set([...common, "no-headers"]),
  slice: new Set([...common, "no-headers", "start", "skip", "end", "len", "index", "indices", "last"]),
};
export async function parseArguments(args: readonly string[], cwd: string, budget: Budget): Promise<Arguments> {
  budget.bound("maxArgs", args.length);
  for (const arg of args) { const size = await budget.textSize(arg); budget.add("maxArgumentBytes", size); }
  const first = args[0] === "h" ? "headers" : args[0];
  if (first === "--help" || first === "-h") {
    if (args.length !== 1) throw new XanError("unexpected argument after help");
    return { command: "headers", inputs: [], noHeaders: false, justNames: false, csv: false, help: true, selection: "", start: 0n };
  }
  if (!first || !Object.hasOwn(allowed, first)) throw new XanError("expected headers, count, select or slice subcommand");
  const command = first as Subcommand;
  const values = new Map<string, string>();
  const operands: string[] = [];
  let positional = false;
  const put = (name: string, value: string): void => {
    if (!allowed[command].has(name)) throw new XanError(`unsupported in bounded CSV profile: --${name}`);
    if (values.has(name)) throw new XanError(`repeated option --${name}`);
    budget.hold(32); values.set(name, value);
  };
  for (let offset = 1; offset < args.length; offset++) {
    const arg = args[offset]!;
    if (!positional && arg === "--") { positional = true; continue; }
    if (!positional && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = arg.slice(2, equals < 0 ? undefined : equals);
      if (command === "headers" && name === "no-headers") throw new UsageError(`${headersUsage}Unknown flag: '--no-headers' Use the -h/--help flag for more information.`);
      if (!allowed[command].has(name)) throw new XanError(`unsupported in bounded CSV profile: --${name}`);
      if (switches.has(name)) {
        if (equals >= 0) throw new XanError(`option --${name} takes no value`);
        put(name, "true");
      } else {
        const value = equals >= 0 ? arg.slice(equals + 1) : args[++offset];
        if (value === undefined) throw new XanError(`missing value for --${name}`);
        put(name, value);
      }
    } else if (!positional && arg.startsWith("-") && arg !== "-") {
      for (let position = 1; position < arg.length; position++) {
        const letter = arg[position]!;
        const name = shortOptions[letter];
        if (command === "headers" && letter === "n") throw new UsageError(`${headersUsage}Unknown flag: '-n' Use the -h/--help flag for more information.`);
        if (!name || !allowed[command].has(name)) throw new XanError(`unsupported in bounded CSV profile: -${letter}`);
        if (switches.has(name)) put(name, "true");
        else {
          const value = position + 1 < arg.length ? arg.slice(position + 1) : args[++offset];
          if (value === undefined) throw new XanError(`missing value for -${letter}`);
          put(name, value); break;
        }
      }
    } else { budget.hold(32); operands.push(arg); }
  }
  const help = values.has("help");
  const selection = command === "select" ? operands.shift() : "";
  if (selection === undefined && !help) throw new UsageError("Usage:\n    xan select [options] [--] <selection> [<input>]\n    xan select --help\n\nInvalid subcommand or arguments! Use the -h/--help flag for more information.");
  if (command !== "headers" && operands.length > 1) throw new XanError("too many input files");
  if (operands.filter(path => path === "-").length > 1) throw new XanError("stdin may appear only once");
  if (!operands.length) operands.push("-");
  budget.bound("maxInputFiles", operands.length);
  const path = (value: string): string => {
    if (!value || value.includes("\0")) throw new XanError("invalid path");
    if (/\.(gz|zst|cdx|ndjson|jsonl|vcf|gtf|gff2|sam|bed)$/u.test(value)) throw new XanError(`unsupported in bounded CSV profile: format ${value}`);
    return value === "-" ? value : resolvePath(cwd, value);
  };
  for (const operand of operands) path(operand);
  const output = values.get("output");
  if (output !== undefined) path(output);
  let delimiter: number | undefined;
  if (values.has("delimiter")) {
    const text = values.get("delimiter")!;
    delimiter = text === "\\t" ? 9 : text.length === 1 ? text.charCodeAt(0) : -1;
    if (delimiter < 1 || delimiter > 127 || [10, 13, 34].includes(delimiter)) throw new XanError("unsupported in bounded CSV profile: delimiter");
  }
  if (values.has("color") && !["auto", "never"].includes(values.get("color")!)) throw new XanError("unsupported in bounded CSV profile: color");
  const numbers = new Map<string, bigint>();
  for (const name of ["start", "skip", "end", "len", "index", "last"]) if (values.has(name)) numbers.set(name, await unsigned(values.get(name)!, `--${name}`, budget));
  const range = ["start", "skip", "end", "len", "index"].some(name => values.has(name));
  if ((values.has("last") && (values.has("indices") || range)) || (values.has("indices") && range)) throw new XanError("conflicting slice modes");
  if (values.has("index") && ["start", "skip", "end", "len"].some(name => values.has(name))) throw new XanError("conflicting index/range options");
  if (values.has("end") && values.has("len")) throw new XanError("conflicting end/len options");
  let start = numbers.get("start") ?? numbers.get("skip") ?? 0n;
  let end = numbers.get("end");
  if (numbers.has("index")) { start = numbers.get("index")!; end = checkedAdd(start, 1n); }
  if (numbers.has("len")) end = checkedAdd(start, numbers.get("len")!);
  if (end !== undefined && start > end) throw new XanError("start exceeds end");
  let last: number | undefined;
  if (numbers.has("last")) { const value = numbers.get("last")!; if (value > BigInt(budget.limits.maxLastRows)) budget.bound("maxLastRows", budget.limits.maxLastRows + 1); last = Number(value); }
  let indices: bigint[] | undefined;
  if (values.has("indices")) {
    const text = values.get("indices")!;
    budget.bound("maxSelectorBytes", await budget.textSize(text));
    indices = [];
    let begin = 0;
    for (let offset = 0; offset <= text.length; offset++) {
      budget.work();
      if (offset === text.length || text[offset] === ",") {
        budget.add("maxSelectorNodes", 1); budget.hold(8);
        indices.push(await unsigned(text.slice(begin, offset), "-I/--indices", budget)); begin = offset + 1;
      }
      if ((offset & 1023) === 0) await budget.checkpoint();
    }
    await boundedSort(indices, 8, budget, (left, right) => { budget.work(8); return left < right ? -1 : left > right ? 1 : 0; });
    let count = 0;
    for (const value of indices) if (count === 0 || indices[count - 1] !== value) indices[count++] = value;
    budget.release((indices.length - count) * 8); indices.length = count;
  }
  budget.release(values.size * 32);
  return { command, inputs: operands, noHeaders: values.has("no-headers"), justNames: values.has("just-names"), csv: values.has("csv"), help, selection: selection ?? "", start,
    ...(output !== undefined && output !== "-" ? { output: path(output) } : {}),
    ...(delimiter !== undefined ? { delimiter } : {}), ...(end !== undefined ? { end } : {}), ...(indices !== undefined ? { indices } : {}), ...(last !== undefined ? { last } : {}),
  };
}
