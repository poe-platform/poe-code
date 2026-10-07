import { resolvePath } from "safe-bash-contracts/path";
import { Budget, XanError } from "./budget.js";
import { boundedSort } from "./sort.js";

export type Subcommand = "headers" | "count" | "select" | "slice" | "head" | "tail" | "sort" | "search" | "filter" | "reverse" | "rename" | "drop" | "stats" | "freq" | "join" | "dedup" | "enum" | "transpose" | "agg" | "groupby" | "to" | "from" | "cat" | "split" | "map" | "top" | "table";
export interface Arguments {
  command: Subcommand;
  options?: ReadonlyMap<string, string>;
  operand?: string;
  rightSelection?: string;
  inputs: string[];
  output?: string;
  delimiter?: number;
  noHeaders: boolean;
  justNames: boolean;
  csv: boolean;
  help: boolean;
  selection: string;
  evaluate?: boolean;
  evaluateFile?: boolean;
  start: bigint;
  end?: bigint;
  indices?: bigint[];
  last?: number;
  humanReadable?: boolean;
  checkAlignment?: boolean;
  parallel?: boolean;
  byteOffset?: bigint;
  endByte?: bigint;
  raw?: boolean;
  startCondition?: string;
  endCondition?: string;
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
    if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
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
const shortOptions: Record<string, string> = { B: "byte-offset", S: "start-condition", E: "end-condition", H: "human-readable", c: "check-alignment", a: "approx", p: "parallel", t: "threads", h: "help", o: "output", d: "delimiter", n: "no-headers", j: "just-names", s: "start", e: "end", l: "len", i: "index", I: "indices", L: "last" };
const switches = new Set(["help", "no-headers", "just-names", "csv", "human-readable", "check-alignment", "approx", "parallel", "raw", "evaluate", "evaluate-file"]);
const extraShort: Partial<Record<Subcommand, Record<string, string>>> = {
  top: { l: "limit", R: "reverse" },
  table: { s: "select" },
  dedup: { s: "select", l: "keep-last", S: "sorted" }, enum: { c: "column-name", S: "start" },
  from: { f: "format" }, cat: { p: "pad" }, split: { S: "size", O: "out-dir", f: "filename", c: "chunks" },
  head: { l: "limit" }, tail: { l: "limit" },
  sort: { s: "select", N: "numeric", R: "reverse", u: "uniq" },
  search: { s: "select", e: "exact", i: "ignore-case", v: "invert-match", l: "limit" },
  filter: { v: "invert-match" }, rename: { s: "select" },
  stats: { s: "select" }, freq: { s: "select", l: "limit", A: "all", N: "no-extra" },
  join: { i: "ignore-case" },
};
for (const name of ["keep-last", "sorted", "keep-duplicates", "pad", "sort-keys", "single-object", "omit", "numeric", "reverse", "uniq", "exact", "ignore-case", "invert-match", "every-column", "all", "no-extra", "inner", "left", "right", "full", "semi", "anti", "cross", "nulls"]) switches.add(name);
const common = ["help", "output", "delimiter"];
const allowed: Record<Subcommand, Set<string>> = {
  map: new Set([...common, "no-headers"]),
  top: new Set([...common, "no-headers", "limit", "reverse"]),
  table: new Set([...common, "no-headers", "select"]),
  dedup: new Set([...common, "no-headers", "select", "keep-last", "sorted", "keep-duplicates"]),
  enum: new Set([...common, "no-headers", "column-name", "start"]),
  transpose: new Set(common),
  agg: new Set([...common, "no-headers"]), groupby: new Set([...common, "no-headers"]),
  to: new Set([...common, "no-headers", "nulls", "omit"]),
  from: new Set([...common, "format", "sort-keys", "single-object", "column-name"]),
  cat: new Set([...common, "no-headers", "pad"]),
  split: new Set(["help", "delimiter", "no-headers", "size", "out-dir", "filename", "chunks"]),
  head: new Set([...common, "no-headers", "limit"]),
  tail: new Set([...common, "no-headers", "limit"]),
  sort: new Set([...common, "no-headers", "select", "numeric", "reverse", "uniq"]),
  search: new Set([...common, "no-headers", "select", "exact", "ignore-case", "invert-match", "every-column", "limit"]),
  filter: new Set([...common, "no-headers", "invert-match"]),
  reverse: new Set([...common, "no-headers"]),
  rename: new Set([...common, "no-headers", "select"]),
  drop: new Set([...common, "no-headers"]),
  stats: new Set([...common, "no-headers", "select", "nulls"]),
  freq: new Set([...common, "no-headers", "select", "limit", "all", "no-extra"]),
  join: new Set([...common, "no-headers", "inner", "left", "right", "full", "semi", "anti", "cross", "nulls", "ignore-case", "drop-key"]),
  headers: new Set([...common, "just-names", "csv", "start", "color"]),
  count: new Set([...common, "no-headers", "human-readable", "check-alignment", "approx", "parallel", "threads"]),
  select: new Set([...common, "no-headers", "evaluate", "evaluate-file"]),
  slice: new Set([...common, "no-headers", "start", "skip", "end", "len", "index", "indices", "last", "byte-offset", "end-byte", "raw", "start-condition", "end-condition"]),
};
export async function parseArguments(args: readonly string[], cwd: string, budget: Budget): Promise<Arguments> {
  budget.bound("maxArgs", args.length);
  for (const arg of args) { const size = await budget.textSize(arg); budget.add("maxArgumentBytes", size); }
  const first = args[0] === "h" ? "headers" : args[0] === "frequency" ? "freq" : args[0] === "view" ? "table" : args[0];
  if (first === "--help" || first === "-h") {
    if (args.length !== 1) throw new XanError("unexpected argument after help");
    return { command: "headers", inputs: [], noHeaders: false, justNames: false, csv: false, help: true, selection: "", start: 0n };
  }
  if (!first || !Object.hasOwn(allowed, first)) throw new XanError("expected a CSV subcommand (use xan --help)");
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
        const name = extraShort[command]?.[letter] ?? (command === "select" && letter === "e" ? "evaluate" : command === "select" && letter === "f" ? "evaluate-file" : shortOptions[letter]);
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
  const parallel = values.has("parallel") || values.has("threads");
  if (values.has("threads") && await unsigned(values.get("threads")!, "--threads", budget) === 0n) throw new XanError("--threads must be positive");
  if (values.has("approx") && values.has("check-alignment")) throw new XanError("-a/--approx does not work with -c/--check-alignment!");
  if (parallel && (values.has("approx") || values.has("check-alignment"))) throw new XanError("-p/--parallel or -t/--threads cannot be used with -a/--approx nor -c/--check-alignment!");
  const help = values.has("help");
  if (!help && (parallel || values.has("approx")) && (!operands.length || operands[0] === "-")) throw new XanError("count execution options require a file path");
  if (values.has("evaluate") && values.has("evaluate-file")) throw new XanError("conflicting expression modes");
  let rightSelection: string | undefined;
  let operand: string | undefined;
  if (command === "map") {
    operand = operands.shift();
    const inlineAs = operand?.match(/^(.*)\s+[aA][sS]\s+([A-Za-z_][A-Za-z0-9_]*)$/s);
    if (
      inlineAs &&
      (operands.length === 0 ||
        (operands.length === 1 &&
          (operands[0] === "-" ||
            operands[0]!.includes("/") ||
            /\.(csv|tsv|txt)$/iu.test(operands[0]!))))
    ) {
      if (operand!.includes(",")) {
        rightSelection = "__INLINE_MULTI__";
      } else {
        operand = inlineAs[1]!.trim();
        rightSelection = inlineAs[2]!;
      }
    } else {
      rightSelection = operands.shift();
    }
    if ((!operand || !rightSelection) && !help) throw new XanError("map requires an expression and a new column name");
  }
  if (command === "groupby") rightSelection = operands.shift();
  if (["search", "filter", "rename", "agg", "groupby", "to", "cat"].includes(command)) {
    operand = operands.shift();
    if (operand === undefined && !help) throw new XanError(`${command} requires an argument`);
  }
  let selection = command === "select" || command === "drop" ? operands.shift() : values.get("select") ?? "";
  if (command === "top") {
    selection = operands.shift();
    if (!selection && !help) throw new XanError("top requires a column selection");
  }
  if (command === "join" && !help) {
    const modes = ["inner", "left", "right", "full", "semi", "anti", "cross"].filter(name => values.has(name));
    if (modes.length > 1) throw new XanError("conflicting join modes");
    if (values.has("cross")) {
      if (operands.length !== 2) throw new XanError("cross join requires two inputs");
    } else {
      if (operands.length !== 3 && operands.length !== 4) throw new XanError("join requires columns and two inputs");
      selection = operands.shift()!;
      rightSelection = operands.length === 3 ? operands.splice(1, 1)[0]! : selection;
    }
    if (values.has("drop-key") && !["none", "left", "right", "both"].includes(values.get("drop-key")!)) throw new XanError("invalid --drop-key mode");
  }
  if (values.has("limit")) await unsigned(values.get("limit")!, "--limit", budget);
  if (selection === undefined && !help) throw new UsageError("Usage:\n    xan select [options] [--] <selection> [<input>]\n    xan select --help\n\nInvalid subcommand or arguments! Use the -h/--help flag for more information.");
  if (command !== "headers" && command !== "join" && command !== "cat" && operands.length > 1) throw new XanError("too many input files");
  if (operands.filter(path => path === "-").length > 1) throw new XanError("stdin may appear only once");
  if (!operands.length) operands.push("-");
  budget.bound("maxInputFiles", operands.length);
  const path = (value: string, input = false): string => {
    if (!value || value.includes("\0")) throw new XanError("invalid path");
    if (input && command !== "from" && /\.(gz|zst|cdx|ndjson|jsonl|vcf|gtf|gff2|sam|bed)$/u.test(value)) throw new XanError(`unsupported in bounded CSV profile: format ${value}`);
    return value === "-" ? value : resolvePath(cwd, value);
  };
  for (const operand of operands) path(operand, true);
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
  for (const name of ["start", "skip", "end", "len", "index", "last", "byte-offset", "end-byte"]) if (values.has(name)) numbers.set(name, await unsigned(values.get(name)!, `--${name}`, budget));
  const byteOffset = numbers.get("byte-offset");
  const endByte = numbers.get("end-byte");
  if (byteOffset !== undefined && endByte !== undefined && endByte <= byteOffset) throw new XanError("-B/--byte-offset must be less than --end-byte!");
  if (values.has("raw") && (byteOffset === undefined || endByte === undefined)) throw new XanError("--raw requires both -B/--byte-offset & --end-byte!");
  if (byteOffset !== undefined && operands[0] === "-") throw new XanError("byte slicing requires a file path");
  if (values.has("indices") && (values.has("start-condition") || values.has("end-condition"))) throw new XanError("indices cannot be combined with conditions");
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
  if (numbers.has("last")) {
    const value = numbers.get("last")!;
    last = Number(value);
    budget.bound("maxLastRows", last);
  }
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
      if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
    }
    await boundedSort(indices, 8, budget, (left, right) => { budget.work(8); return left < right ? -1 : left > right ? 1 : 0; });
    let count = 0;
    for (const value of indices) if (count === 0 || indices[count - 1] !== value) indices[count++] = value;
    budget.release((indices.length - count) * 8); indices.length = count;
  }
  if (command === "head") end = await unsigned(values.get("limit") ?? "10", "--limit", budget);
  if (command === "tail") { last = Number(await unsigned(values.get("limit") ?? "10", "--limit", budget)); budget.bound("maxLastRows", last); }
  return { command: command === "head" || command === "tail" ? "slice" : command,
    options: values, ...(operand !== undefined ? { operand } : {}), ...(rightSelection !== undefined ? { rightSelection } : {}), raw: values.has("raw"), ...(byteOffset !== undefined ? { byteOffset } : {}), ...(endByte !== undefined ? { endByte } : {}), ...(values.has("start-condition") ? { startCondition: values.get("start-condition")! } : {}), ...(values.has("end-condition") ? { endCondition: values.get("end-condition")! } : {}), humanReadable: values.has("human-readable"), checkAlignment: values.has("check-alignment"), parallel, inputs: operands, noHeaders: values.has("no-headers"), justNames: values.has("just-names"), csv: values.has("csv"), help, selection: selection ?? "", start,
    evaluate: values.has("evaluate"), evaluateFile: values.has("evaluate-file"),
    ...(output !== undefined && output !== "-" ? { output: path(output) } : {}),
    ...(delimiter !== undefined ? { delimiter } : {}), ...(end !== undefined ? { end } : {}), ...(indices !== undefined ? { indices } : {}), ...(last !== undefined ? { last } : {}),
  };
}
