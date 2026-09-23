import { ToolError } from "./shared.js";
import { Pattern } from "../text-programs/regex.js";
import type { DisplayOptions } from "./diff-output.js";

export interface DiffFlags extends DisplayOptions {
  format: "normal" | "unified" | "context" | "side" | "ed" | "rcs" | "ifdef";
  whitespace: "exact" | "change" | "all";
  context: number;
  brief: boolean;
  recursive: boolean;
  newFile: boolean;
  labels: string[];
  files: string[];
  optionArgs: string[];
  ignoreCase: boolean;
  ignoreBlank: boolean;
  ignoreTrailing: boolean;
  ignoreTabs: boolean;
  ignorePatterns: Pattern[];
  functions: Pattern[];
  reportSame: boolean;
  text: boolean;
  paginate: boolean;
  excludes: string[];
  excludeFiles: string[];
  startingFile?: string;
}

function contextLength(value: string): number {
  if (!/^(?:[ \t\n\v\f\r]*[+-]?\d+)?$/u.test(value) || Number(value) < 0) {
    throw new ToolError(`invalid context length: ${value}`);
  }
  return Math.min(Number(value), Number.MAX_SAFE_INTEGER);
}

export function flags(args: readonly string[]): DiffFlags {
  const result: DiffFlags = { format: "normal", whitespace: "exact", context: 0, brief: false, recursive: false, newFile: false, labels: [], files: [], optionArgs: [], ignoreCase: false, ignoreBlank: false, ignoreTrailing: false, ignoreTabs: false, ignorePatterns: [], functions: [], reportSame: false, text: false, paginate: false, excludes: [], excludeFiles: [], width: 130, expand: false, initialTab: false, leftColumn: false, suppressCommon: false, symbol: "" };
  let selectedFormat: DiffFlags["format"] | undefined;
  const selectFormat = (format: DiffFlags["format"]) => {
    if (selectedFormat !== undefined && selectedFormat !== format) throw new ToolError("conflicting output format options");
    selectedFormat = result.format = format;
  };
  let explicitContext = false;
  let legacyContext = -1;
  let previousDigit = false;
  const selectContext = (format: "unified" | "context", width: number, explicit: boolean) => {
    selectFormat(format);
    result.context = Math.max(result.context, width);
    explicitContext ||= explicit;
  };
  let operands = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const optionStart = index;
    const isOption = !operands && arg !== "-" && arg.startsWith("-");
    if (!operands && arg.startsWith("--")) previousDigit = false;
    const value = (attached: string | undefined, name: string) => {
      const next = attached ?? args[++index];
      if (next === undefined) throw new ToolError(`${name} requires an argument`);
      return next;
    };
    if (operands || arg === "-" || !arg.startsWith("-")) result.files.push(arg);
    else if (arg === "--") operands = true;
    else if (arg === "--brief") result.brief = true;
    else if (arg === "--recursive") result.recursive = true;
    else if (arg === "--new-file") result.newFile = true;
    else if (arg === "--ignore-case") result.ignoreCase = true;
    else if (arg === "--ignore-blank-lines") result.ignoreBlank = true;
    else if (arg === "--ignore-trailing-space") result.ignoreTrailing = true;
    else if (arg === "--ignore-tab-expansion") result.ignoreTabs = true;
    else if (arg === "--report-identical-files") result.reportSame = true;
    else if (arg === "--text") result.text = true;
    else if (arg === "--minimal") { /* The bounded LCS already minimizes edits. */ }
    else if (arg === "--side-by-side") selectFormat("side");
    else if (arg === "--ed") selectFormat("ed");
    else if (arg === "--rcs") selectFormat("rcs");
    else if (arg === "--expand-tabs") result.expand = true;
    else if (arg === "--initial-tab") result.initialTab = true;
    else if (arg === "--left-column") result.leftColumn = true;
    else if (arg === "--suppress-common-lines") result.suppressCommon = true;
    else if (arg === "--paginate") result.paginate = true;
    else if (arg === "--show-c-function") result.functions.push(new Pattern("^[A-Za-z_$]", false));
    else if (["--width", "--ifdef", "--ignore-matching-lines", "--show-function-line", "--exclude", "--exclude-from", "--starting-file"].some(name => arg === name || arg.startsWith(`${name}=`))) {
      const equal = arg.indexOf("=");
      const name = equal < 0 ? arg : arg.slice(0, equal);
      const parameter = value(equal < 0 ? undefined : arg.slice(equal + 1), name);
      if (name === "--width") result.width = outputWidth(parameter);
      else if (name === "--ifdef") { selectFormat("ifdef"); result.symbol = parameter; }
      else if (name === "--ignore-matching-lines") result.ignorePatterns.push(new Pattern(parameter, false));
      else if (name === "--show-function-line") result.functions.push(new Pattern(parameter, false));
      else if (name === "--exclude") result.excludes.push(parameter);
      else if (name === "--exclude-from") result.excludeFiles.push(parameter);
      else result.startingFile = parameter;
    }
    else if (arg === "--ignore-all-space") result.whitespace = "all";
    else if (arg === "--ignore-space-change") { if (result.whitespace !== "all") result.whitespace = "change"; }
    else if (arg === "--normal") selectFormat("normal");
    else if (arg === "--unified") selectContext("unified", 3, true);
    else if (arg.startsWith("--unified=")) selectContext("unified", contextLength(arg.slice(10)), true);
    else if (arg === "--context") selectContext("context", 3, true);
    else if (arg.startsWith("--context=")) selectContext("context", contextLength(arg.slice(10)), true);
    else if (arg === "--label" || arg.startsWith("--label=")) result.labels.push(value(arg.includes("=") ? arg.slice(8) : undefined, "--label"));
    else if (arg.startsWith("--")) throw new ToolError(`unsupported option: ${arg}`);
    else {
      for (let offset = 1; offset < arg.length; offset++) {
        const flag = arg[offset]!;
        if (/^\d$/u.test(flag)) {
          legacyContext = Math.min((previousDigit ? legacyContext : 0) * 10 + Number(flag), Number.MAX_SAFE_INTEGER);
          previousDigit = true;
          continue;
        }
        previousDigit = false;
        if (flag === "u") selectContext("unified", 3, false);
        else if (flag === "c") selectContext("context", 3, false);
        else if (flag === "q") result.brief = true;
        else if (flag === "r") result.recursive = true;
        else if (flag === "N") result.newFile = true;
        else if (flag === "i") result.ignoreCase = true;
        else if (flag === "B") result.ignoreBlank = true;
        else if (flag === "Z") result.ignoreTrailing = true;
        else if (flag === "E") result.ignoreTabs = true;
        else if (flag === "s") result.reportSame = true;
        else if (flag === "a") result.text = true;
        else if (flag === "d") { /* LCS minimizes the edit count. */ }
        else if (flag === "y") selectFormat("side");
        else if (flag === "e") selectFormat("ed");
        else if (flag === "n") selectFormat("rcs");
        else if (flag === "t") result.expand = true;
        else if (flag === "T") result.initialTab = true;
        else if (flag === "l") result.paginate = true;
        else if (flag === "p") result.functions.push(new Pattern("^[A-Za-z_$]", false));
        else if (flag === "w") result.whitespace = "all";
        else if (flag === "b") { if (result.whitespace !== "all") result.whitespace = "change"; }
        else if ("UCLWDIFxXS".includes(flag)) {
          const parameter = value(arg.slice(offset + 1) || undefined, `-${flag}`);
          if (flag === "U") selectContext("unified", contextLength(parameter), true);
          else if (flag === "C") selectContext("context", contextLength(parameter), true);
          else if (flag === "L") result.labels.push(parameter);
          else if (flag === "W") result.width = outputWidth(parameter);
          else if (flag === "D") { selectFormat("ifdef"); result.symbol = parameter; }
          else if (flag === "I") result.ignorePatterns.push(new Pattern(parameter, false));
          else if (flag === "F") result.functions.push(new Pattern(parameter, false));
          else if (flag === "x") result.excludes.push(parameter);
          else if (flag === "X") result.excludeFiles.push(parameter);
          else result.startingFile = parameter;
          break;
        } else throw new ToolError(`unsupported option: -${flag}`);
      }
    }
    if (isOption) result.optionArgs.push(...args.slice(optionStart, index + 1));
  }
  if (legacyContext >= 0 && (result.format === "unified" || result.format === "context")) {
    result.context = explicitContext ? Math.max(result.context, legacyContext) : legacyContext;
  }
  if (result.files.length !== 2) throw new ToolError("expected two files or directories");
  if (selectedFormat === undefined && result.functions.length) { result.format = "context"; result.context = Math.max(3, result.context); }
  if (result.labels.length > 2) throw new ToolError("at most two labels are supported");
  for (const name of [...result.labels, ...result.files]) {
    if (!name || /[\0\r\n\t]/u.test(name)) throw new ToolError("empty names or control characters in filenames/labels are unsupported");
  }
  return result;
}

function outputWidth(value: string): number {
  const width = contextLength(value);
  if (width < 1) throw new ToolError(`invalid width: ${value}`);
  return width;
}
