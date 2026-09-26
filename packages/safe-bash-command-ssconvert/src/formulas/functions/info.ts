import { formatA1 } from "../../workbook.js";
import { blank, error, numeric, numericResult, rendered } from "../values.js";
import { bool, collect, numberArg, scalarArg, str, textArg, unsupported } from "./common.js";
import { matchNumber } from "./text.js";
import { parseExpression } from "../parser.js";
import { serializeExpression } from "../serialization.js";
import type { FormulaNode } from "../ast.js";
import type { FunctionHost, FunctionImplementation, Reference, SpecialForm, Value } from "./types.js";

function asciiKeyword(text: string): string {
  return Array.from(text, c => c >= "A" && c <= "Z" ? c.toLowerCase() : c).join("");
}

function metadata(name: string, args: readonly (Value | undefined)[], host: FunctionHost): Value {
  const value = args[0];
  if (value?.kind !== "range") return name === "ISFORMULA" ? error("#REF!") : blank;
  if (value.sheets.length !== 1 || value.firstRow !== value.lastRow || value.firstColumn !== value.lastColumn) return error("#REF!");
  const cell = host.cell(value.sheets[0]!, value.firstRow, value.firstColumn);
  if (name === "ISFORMULA") return bool(!!cell?.formula);
  if (name === "GET.LINK") {
    // Hyperlinks not represented by the workbook model cannot be guessed from text.
    if (cell?.style?.hyperlink !== undefined) unsupported("GET.LINK imported hyperlink representation");
    return blank;
  }
  if (!cell?.formula) return blank;
  const parsed = parseExpression(cell.formula, { position: { sheet: value.sheets[0]!.id, row: cell.row, column: cell.column }, arrayStringLiterals: cell.arrayStringLiterals ?? false, workbook: host.book,
    signal: host.context.signal, maximumLength: host.context.limits.inputBytes, maximumNodes: host.context.limits.workbookWork ?? host.context.limits.cells * 32 + host.context.limits.inputBytes });
  if (!parsed.ok) unsupported("formula metadata syntax");
  const pending: FormulaNode[] = [parsed.document.root];
  while (pending.length) {
    host.tick(); const node = pending.pop()!;
    if (node.kind === "parentheses" || node.kind === "unary") pending.push(node.child);
    else if (node.kind === "binary") pending.push(node.left, node.right);
    else if (node.kind === "call") pending.push(...node.args);
    else if (node.kind === "array") for (const row of node.rows) pending.push(...row);
  }
  const formula = serializeExpression(parsed.document, parsed.document.grammar, false, true);
  return str(name === "EXPRESSION" ? formula.slice(1) : formula);
}
function cellInformation(type: string, range: Reference, host: FunctionHost): Value {
  const sheet = range.sheets[0]!;
  const cell = host.cell(sheet, range.firstRow, range.firstColumn);
  if (["address", "coord"].includes(type)) {
    const address = formatA1(range.firstRow, range.firstColumn), split = address.split("").findIndex(c => c >= "0" && c <= "9");
    return str("$" + address.slice(0, split) + "$" + address.slice(split));
  }
  if (["col", "column"].includes(type)) return numericResult(range.firstColumn + 1);
  if (type === "row") return numericResult(range.firstRow + 1);
  if (type === "sheetname") return str(sheet.name);
  if (["contents", "value"].includes(type)) return host.read(sheet, range.firstRow, range.firstColumn);
  if (["color", "parentheses"].includes(type)) return numericResult(0);
  if (type === "filename") {
    // URI ownership is retained by the loader, not inferred from an ambient cwd.
    if (host.book.properties?.uri !== undefined) return str(String(host.book.properties.uri));
    return str("");
  }
  if (["locked", "protect"].includes(type)) return numericResult(cell?.style?.locked === false ? 0 : 1);
  if (["type", "datatype", "formulatype"].includes(type)) {
    const value = host.read(sheet, range.firstRow, range.firstColumn);
    return str(value.kind === "blank" ? "b" : value.kind === "string" || value.kind === "byte-string" ? "l" : "v");
  }
  if (["prefix", "prefixcharacter"].includes(type)) {
    const value = host.read(sheet, range.firstRow, range.firstColumn);
    if (value.kind !== "string" && value.kind !== "byte-string") return str("");
    const align = cell?.style?.horizontalAlignment;
    return str(align === "right" ? '"' : align === "center" || align === "center-across-selection" ? "^" : align === "fill" ? "\\" : "'");
  }
  if (type === "format") {
    const format = cell?.format ?? "General";
    const dateFormats: Readonly<Record<string, string>> = {
      "m/d/yy": "D4", "m/d/yy h:mm": "D4", "mm/dd/yy": "D4",
      "d-mmm-yy": "D1", "dd-mmm-yy": "D1", "d-mmm": "D2", "dd-mmm": "D2",
      "mmm-yy": "D3", "mm/dd": "D5", "h:mm am/pm": "D7", "h:mm:ss am/pm": "D6",
      "h:mm": "D9", "h:mm:ss": "D8"
    };
    const dateCode = dateFormats[format.toLowerCase()];
    if (dateCode !== undefined) return str(dateCode);
    if (format.toLowerCase() === "general" || format === "@") return str("G");
    if (format.includes("[") || format.includes(";") || format.includes("/") || format.includes("m") || format.includes("d")) unsupported("CELL format classification");
    const dot = format.indexOf("."), count = dot < 0 ? 0 : Array.from(format.slice(dot + 1)).filter(c => "0#".includes(c)).length;
    return str((format.includes("%") ? "P" : format.includes("$") ? "C" : format.includes("E") ? "S" : format.includes(",") ? "," : "F") + count);
  }
  if (["width", "columnwidth"].includes(type)) unsupported("CELL font-dependent column width");
  return error("#VALUE!");
}
const predicates: Readonly<Record<string, (value: ReturnType<FunctionHost["scalar"]>) => boolean>> = {
  ISBLANK: value => value.kind === "blank",
  ISERR: value => value.kind === "error" && value.value !== "#N/A",
  ISERROR: value => value.kind === "error",
  ISLOGICAL: value => value.kind === "boolean",
  ISNA: value => value.kind === "error" && value.value === "#N/A",
  ISNONTEXT: value => value.kind !== "string" && value.kind !== "byte-string",
  ISNUMBER: value => value.kind === "number",
  ISTEXT: value => value.kind === "string" || value.kind === "byte-string"
};
export const infoFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(Object.entries(predicates).map(([name, predicate]) => [name, ((args, host) => bool(predicate(scalarArg(args, 0, host)))) satisfies FunctionImplementation])),
  ERROR: (args, host) => error(textArg(args, 0, host)),
  "ERROR.TYPE": (args, host) => {
    const value = scalarArg(args, 0, host), index = value.kind === "error" ? ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].indexOf(value.value) : -1;
    return index < 0 ? error("#N/A") : numericResult(index + 1);
  },
  NA: () => error("#N/A"),
  ISEVEN: (args, host) => bool(Math.abs(numberArg(args, 0, host)) % 2 < 1),
  ISODD: (args, host) => {
    const value = scalarArg(args, 0, host);
    let n = numeric(value) ?? 0;
    if (value.kind === "string") {
      n = 0;
      let start = 0;
      while (start < value.value.length && " \t\n\r\v\f".includes(value.value[start]!)) { host.tick(); start++; }
      const first = value.value[start];
      // parseFloat accepts Unicode leading whitespace, unlike the captured C locale.
      if (first !== undefined && "+-.0123456789".includes(first)) n = Number.parseFloat(value.value.slice(start));
    }
    return bool(Math.abs(n) % 2 >= 1);
  },
  N: (args, host) => {
    const value = scalarArg(args, 0, host);
    if (value.kind === "byte-string") return numericResult(0);
    if (value.kind === "number" || value.kind === "boolean") return numericResult(numeric(value)!);
    if (value.kind !== "string") return error("#NUM!");
    const matched = matchNumber(rendered(value), host);
    return typeof matched === "boolean" ? bool(matched) : numericResult(matched ?? 0);
  },
  TYPE: args => {
    const value = args[0];
    return numericResult(value?.kind === "matrix" ? 64 : value?.kind === "set" || value?.kind === "range" || value?.kind === "error" ? 16 : value?.kind === "string" || value?.kind === "byte-string" ? 2 : value?.kind === "boolean" ? 4 : 1);
  },
  COUNTBLANK: (args, host) => numericResult(collect(args[0]!, host).filter(value => value.kind === "blank" || value.kind === "string" && value.value === "").length),
  GETENV: (args, host) => {
    const name = textArg(args, 0, host), env = host.context.environment.env;
    return Object.hasOwn(env, name) ? str(env[name]!) : error("#N/A");
  },
  INFO: (args, host) => {
    const type = asciiKeyword(textArg(args, 0, host));
    if (["directory", "origin"].includes(type)) return error("Unimplemented");
    if (type === "memavail") return numericResult(15 * 1048576);
    if (type === "memused") return numericResult(1048576);
    if (type === "totmem") return numericResult(16 * 1048576);
    if (type === "numfile") return numericResult(1);
    if (type === "release") return str("1.12.61");
    if (type === "recalc") return str(host.book.calculationMode === "manual" ? "Manual" : "Automatic");
    if (["system", "osversion"].includes(type)) {
      const identity = type === "system" ? host.context.environment.system : host.context.environment.osVersion;
      if (identity === undefined) unsupported(`INFO ${type} requires captured environment identity`);
      return str(identity);
    }
    return error("Unknown info_type");
  },
  ...Object.fromEntries(["EXPRESSION", "GET.FORMULA", "GET.LINK", "ISFORMULA"].map(name => [name, ((args, host) => metadata(name, args, host)) satisfies FunctionImplementation])),
  CELL: (args, host) => args[1]?.kind === "range" ? cellInformation(asciiKeyword(textArg(args, 0, host)), args[1], host) : error("#VALUE!")
};
export const infoSpecialForms: Readonly<Record<string, SpecialForm>> = {
  ISREF: (args, host) => args.length !== 1 ? error("Invalid number of arguments") : bool(host.evaluate(args[0]!, true).kind === "range")
};
