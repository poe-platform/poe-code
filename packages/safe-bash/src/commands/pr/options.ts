import { Budget, PrError, quote } from "./internal.js";

export interface Options {
  files: string[];
  columns: number;
  explicitColumns: boolean;
  merge: boolean;
  across: boolean;
  length: number;
  width: number;
  header: string | undefined;
  extremities: boolean;
  keepFF: boolean;
  formFeed: boolean;
  numbered: boolean;
  digits: number;
  numberSeparator: string;
  startNumber: number;
  separator: string;
  useSeparator: boolean;
  truncate: boolean;
  join: boolean;
  doubleSpace: boolean;
  margin: number;
  expand: boolean;
  tabify: boolean;
  inputTab: string;
  inputTabWidth: number;
  outputTab: string;
  outputTabWidth: number;
  control: boolean;
  octal: boolean;
  quiet: boolean;
  information: "help" | "version" | undefined;
}

function digit(value: string): boolean { return value >= "0" && value <= "9"; }

function integer(value: string, minimum: number, label: string): number {
  let offset = 0;
  while (" \t\r\n\v\f".includes(value[offset] ?? "!") && offset < value.length) offset++;
  if (value[offset] === "+" || value[offset] === "-") offset++;
  const start = offset;
  while (offset < value.length && digit(value[offset]!)) offset++;
  if (offset !== value.length || offset === start) throw new PrError(`${label}: ${quote(value)}`);
  const result = Number(value);
  if (result < minimum || result > 2147483647 || !Number.isSafeInteger(result)) throw new PrError(`${label}: ${quote(value)}: Numerical result out of range`);
  return result;
}

export function parseOptions(args: string[], budget: Budget): Options {
  const options: Options = {
    files: [], columns: 1, explicitColumns: false, merge: false, across: false,
    length: 66, width: 72, header: undefined, extremities: true, keepFF: false,
    formFeed: false, numbered: false, digits: 5, numberSeparator: "\t", startNumber: 1,
    separator: "", useSeparator: false, truncate: false, join: false, doubleSpace: false,
    margin: 0, expand: false, tabify: false, inputTab: "\t", inputTabWidth: 8,
    outputTab: "\t", outputTabWidth: 8, control: false, octal: false, quiet: false, information: undefined,
  };
  const long: Record<string, string> = {
    columns: "#", across: "a", "show-control-chars": "c", "double-space": "d", "expand-tabs": "e",
    "form-feed": "f", header: "h", "output-tabs": "i", "join-lines": "J", length: "l", merge: "m",
    "number-lines": "n", "first-line-number": "N", indent: "o", "no-file-warnings": "r", separator: "s",
    "sep-string": "S", "omit-header": "t", "omit-pagination": "T", "show-nonprinting": "v", width: "w", "page-width": "W",
  };
  let oldWidth = false, oldSeparator = false, oldOptions = false, stop = false;
  let columnDigits: string | undefined;
  let accumulating = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    budget.charge(argument.length);
    if (stop) { options.files.push(argument); continue; }
    if (argument === "--") { stop = true; continue; }
    if (argument === "--help" || argument === "--version") {
      options.information = argument === "--help" ? "help" : "version";
      return options;
    }
    if (!argument.startsWith("-") || argument === "-") { accumulating = false; options.files.push(argument); continue; }
    const isLong = argument.startsWith("--");
    let switches = argument.slice(1), attached: string | undefined;
    if (isLong) {
      const equal = argument.indexOf("=");
      const name = argument.slice(2, equal < 0 ? undefined : equal);
      const candidates = Object.keys(long).filter(candidate => candidate.startsWith(name));
      if (!Object.hasOwn(long, name) && candidates.length > 1) throw new PrError(`option ${quote(argument)} is ambiguous; possibilities:${candidates.map(candidate => ` '--${candidate}'`).join("")}`, true);
      switches = long[name] ?? (candidates.length === 1 ? long[candidates[0]!] : undefined) ?? "";
      if (!switches) throw new PrError(`unrecognized option ${quote(argument)}`, true);
      if (equal >= 0) attached = argument.slice(equal + 1);
    }
    for (let offset = 0; offset < switches.length; offset++) {
      const option = switches[offset]!;
      if (digit(option)) {
        columnDigits = (accumulating ? columnDigits ?? "" : "") + option;
        accumulating = true;
        continue;
      }
      accumulating = false;
      const required = "#hlwWNo".includes(option);
      const optional = "nseiS".includes(option);
      let value = attached;
      if (required || optional) {
        if (!isLong && offset + 1 < switches.length) value = switches.slice(offset + 1);
        if (required && value === undefined) {
          value = args[++index];
          if (value === undefined) throw new PrError(isLong ? `option ${quote(argument)} requires an argument` : `option requires an argument -- '${option}'`, true);
        }
        offset = switches.length;
      } else if (attached !== undefined) throw new PrError(`option ${quote(argument.slice(0, argument.indexOf("=")))} doesn't allow an argument`, true);
      switch (option) {
        case "#": options.columns = integer(value!, 1, "invalid number of columns"); options.explicitColumns = true; columnDigits = undefined; break;
        case "h": options.header = value; break;
        case "l": options.length = integer(value!, 1, "'-l PAGE_LENGTH' invalid number of lines"); break;
        case "w": oldWidth = true; oldOptions = true; {
          const width = integer(value!, 1, "'-w PAGE_WIDTH' invalid number of characters");
          if (!options.truncate) options.width = width;
        } break;
        case "W": oldWidth = false; options.truncate = true; options.width = integer(value!, 1, "'-W PAGE_WIDTH' invalid number of characters"); break;
        case "m": options.merge = true; break;
        case "a": options.across = true; break;
        case "b": break;
        case "d": options.doubleSpace = true; break;
        case "f": case "F": options.formFeed = true; break;
        case "J": options.join = true; break;
        case "N": options.startNumber = integer(value!, -2147483648, "'-N NUMBER' invalid starting line number"); break;
        case "o": options.margin = integer(value!, 0, "'-o MARGIN' invalid line offset"); break;
        case "r": options.quiet = true; break;
        case "s": oldOptions = true; oldSeparator = true; if (!options.useSeparator && value !== undefined) options.separator = value; break;
        case "S": oldSeparator = false; options.useSeparator = true; options.separator = value ?? ""; break;
        case "t": options.extremities = false; options.keepFF = true; break;
        case "T": options.extremities = false; options.keepFF = false; break;
        case "c": options.control = true; break;
        case "v": options.octal = true; break;
        case "n": case "e": case "i": {
          if (option === "n") options.numbered = true;
          if (option === "e") options.expand = true;
          if (option === "i") options.tabify = true;
          if (value === undefined || !value.length) break;
          let character: string | undefined;
          if (!digit(value[0]!)) { character = value[0]; value = value.slice(1); }
          let count: number | undefined;
          if (value.length) {
            try { count = integer(value, 1, "invalid number"); }
            catch { throw new PrError(`'-${option}' extra characters or invalid number in the argument: ${quote(value)}${Number(value) > 2147483647 ? ": Value too large for defined data type" : ""}`, true); }
          }
          if (option === "n") { options.numberSeparator = character ?? options.numberSeparator; options.digits = count ?? options.digits; }
          if (option === "e") { options.inputTab = character ?? options.inputTab; options.inputTabWidth = count ?? options.inputTabWidth; }
          if (option === "i") { options.outputTab = character ?? options.outputTab; options.outputTabWidth = count ?? options.outputTabWidth; }
          break;
        }
        default: throw new PrError(`invalid option -- '${option}'`, true);
      }
    }
  }
  if (columnDigits !== undefined) { options.columns = integer(columnDigits, 1, "invalid number of columns"); options.explicitColumns = true; }
  if (options.merge && options.explicitColumns) throw new PrError("cannot specify number of columns when printing in parallel");
  if (options.merge && options.across) throw new PrError("cannot specify both printing across and printing in parallel");
  if (oldOptions) {
    if (oldWidth) {
      if (options.merge || options.explicitColumns) { options.truncate = true; if (oldSeparator) options.useSeparator = true; }
      else options.join = true;
    } else if (!options.useSeparator && oldSeparator && (options.merge || options.explicitColumns)) {
      if (!options.truncate) { options.join = true; if (options.separator.length) options.useSeparator = true; }
      else options.useSeparator = true;
    }
  }
  const { limits } = budget;
  budget.check(options.files.length, limits.maxFiles, "input files");
  budget.check(options.merge ? Math.max(1, options.files.length) : options.columns, limits.maxColumns, "columns");
  budget.check(options.length, limits.maxPageLines, "page lines");
  for (const width of [options.width, options.margin, options.digits, options.inputTabWidth, options.outputTabWidth]) budget.check(width, limits.maxPageWidth, "page width");
  return options;
}
