import { isUnicodeAlpha } from "../workbook/unicode-sheet-name.js";
import { gnumericGrammar } from "./conventions.js";
import { statisticsFunctionDescriptors } from "./statistics-function-descriptors.js";
import { statisticsQuantileExports } from "./statistics-export-names.js";
import type { FormulaDocument, FormulaGrammar, FormulaNode, ParsePosition, ReferenceEndpoint } from "./ast.js";
import { SsconvertError } from "../contracts.js";
import { dateFinanceFunctionDescriptors } from "./date-finance-function-descriptors.js";
import { numericFunctionDescriptors } from "./numeric-function-descriptors.js";

export function quoteFormulaString(value: string, quote: string, grammar: FormulaGrammar): string {
  if (grammar.stringEscape === "raw") return quote + value + quote;
  if (grammar.stringEscape === "double") return quote + value.split(quote).join(quote + quote) + quote;
  let text = quote;
  for (const c of value) text += c === quote || c === "\\" ? "\\" + c : c;
  return text + quote;
}

// parse-util.c:std_sheet_name_quote, including Excel's leading-zero row quirk.
export function quoteNativeSheet(name: string): string {
  const chars = [...name];
  const asciiLetter = (c: string) => c >= "A" && c <= "Z" || c >= "a" && c <= "z";
  if (!chars[0] || !(isUnicodeAlpha(chars[0].codePointAt(0)!) || chars[0] === "_") ||
    chars.some(c => !(isUnicodeAlpha(c.codePointAt(0)!) || c >= "0" && c <= "9" || c === "." || c === "_")))
    return quoteFormulaString(name, "'", gnumericGrammar);
  let i = 0, column = 0;
  while (chars[i] && asciiLetter(chars[i]!)) {
    column = column * 26 + chars[i]!.toUpperCase().charCodeAt(0) - 64;
    i++;
  }
  const rowText = chars.slice(i).join("");
  if (column > 0 && column <= 16384 && rowText.length > 0 &&
    [...rowText].every(c => c >= "0" && c <= "9") && Number(rowText) > 0 && Number(rowText) <= 16777216)
    return quoteFormulaString(name, "'", gnumericGrammar);
  return name;
}

export function serializeReference(first: ReferenceEndpoint, last: ReferenceEndpoint | undefined, grammar: FormulaGrammar, position: ParsePosition): string {
  if (grammar.wholeAxisReferences === false && (!first.row || !first.column || last && (!last.row || !last.column)))
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: whole-axis formula reference in target grammar");
  if (!last && grammar.address === "a1" && (!first.row || !first.column)) last = first;
  const address = (ref: ReferenceEndpoint): string => {
    const axis = (kind: "row" | "column"): string => {
      const value = ref[kind]; if (!value) return "";
      if (grammar.address === "r1c1" && value.relative) return (kind === "row" ? "R" : "C") + (value.value === 0 ? "" : `[${value.value}]`);
      const coordinate = value.value + (value.relative ? position[kind] : 0);
      if (!Number.isSafeInteger(coordinate) || coordinate < 0) return "#REF!";
      if (grammar.address === "r1c1") return (kind === "row" ? "R" : "C") + (value.relative ? value.value === 0 ? "" : `[${value.value}]` : String(value.value + 1));
      let text = "";
      if (kind === "row") text = String(coordinate + (grammar.rowBase ?? 1));
      else { let n = coordinate + 1; while (n) { const digit = (n - 1) % 26; text = String.fromCharCode(65 + digit) + text; n = Math.floor((n - 1) / 26); } }
      return (value.relative ? "" : "$") + text;
    };
    const row = axis("row"), column = axis("column");
    if (row === "#REF!" || column === "#REF!") return "#REF!";
    return grammar.address === "r1c1" ? row + column : column + row;
  };
  const sheet = (name: string): string => {
    if (grammar.quoteSheetName) return grammar.quoteSheetName(name);
    if (!grammar.unquotedSheets) return quoteFormulaString(name, "'", grammar);
    if (!name || Array.from(name).some(c => !(c >= "A" && c <= "Z" || c >= "a" && c <= "z" || c >= "0" && c <= "9")))
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: unquoted formula sheet name");
    return name;
  };
  const external = first.workbook === undefined ? "" : grammar.bracketReferences ? sheet(first.workbook) + "#" : "[" + first.workbook + "]";
  if (grammar.bracketReferences) {
    const endpoint = (ref: ReferenceEndpoint) => (ref.sheet ? sheet(ref.sheet) : "") + "." + address(ref);
    return "[" + external + endpoint(first) + (last ? ":" + endpoint(last) : "") + "]";
  }
  if (grammar.qualifiedRangeEndpoints) {
    const endpoint = (ref: ReferenceEndpoint) => (ref.sheet ? sheet(ref.sheet) + grammar.sheetSeparator : "") + address(ref);
    return external + endpoint(first) + (last ? (grammar.rangeSeparator ?? ":") + endpoint(last) : "");
  }
  const span = last?.sheet && last.sheet !== first.sheet ? sheet(first.sheet ?? position.sheet) + ":" + sheet(last.sheet) + grammar.sheetSeparator :
    first.sheet ? sheet(first.sheet) + grammar.sheetSeparator : "";
  const a = address(first), b = last ? address(last) : undefined;
  if (a === "#REF!" || b === "#REF!") return external + span + "#REF!";
  return external + span + a + (last && (a !== b || last.sheet === first.sheet) ? ":" + b : "");
}

/** Serialize the tree, retaining explicit grouping even across different precedences. */
export function serializeExpression(document: FormulaDocument, grammar = document.grammar, preserveSource = true, canonical = false): string {
  if (preserveSource && grammar === document.grammar) return document.source;
  const position = { ...document.position, sheet: document.sheetNames?.[document.position.sheet] ?? document.position.sheet };
  function emit(value: FormulaNode, parentPrecedence = -1): string {
    if (value.kind === "literal" && value.value.kind === "error" && !grammar.quotedErrors && !["#NAME?", "#REF!", "#VALUE!", "#NUM!", "#DIV/0!", "#N/A", "#NULL!"].includes(value.value.value))
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: custom formula error in target grammar");
    switch (value.kind) {
      case "literal": return value.value.kind === "blank" ? "" : value.value.kind === "string" ? quoteFormulaString(value.value.value, '"', grammar) :
        value.value.kind === "error" && grammar.quotedErrors && !["#NAME?", "#REF!", "#VALUE!", "#NUM!", "#DIV/0!", "#N/A", "#NULL!"].includes(value.value.value) ? "#" + quoteFormulaString(value.value.value, '"', grammar) :
        value.value.kind === "boolean" ? (value.value.value ? "TRUE" : "FALSE") + (grammar.booleanFunctions ? "()" : "") : String(value.value.value);
      case "omitted": return "";
      case "reference": return serializeReference(value.first, value.last, grammar, position);
      case "name": {
        if (grammar.qualifiedNames === false && (value.sheet !== undefined || value.workbook !== undefined))
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: qualified formula name in target grammar");
        const external = value.workbook === undefined ? "" : grammar.bracketReferences ? quoteFormulaString(value.workbook, "'", grammar) + "#" : "[" + quoteFormulaString(value.workbook, "'", grammar) + "]";
        const text = external + (value.sheet ? (grammar.quoteSheetName?.(value.sheet) ?? quoteFormulaString(value.sheet, "'", grammar)) + grammar.sheetSeparator : "") + value.name;
        return grammar.bracketReferences && (value.sheet || value.workbook !== undefined) ? "[" + text + "]" : text;
      }
      case "parentheses": return "(" + emit(value.child) + ")";
      case "unary": {
        if (!canonical) return value.op === "%" ? "(" + emit(value.child) + ")%" : value.op + "(" + emit(value.child) + ")";
        const precedence = value.op === "%" ? 6 : 7;
        const text = value.op === "%" ? emit(value.child, precedence) + "%" : value.op + emit(value.child, precedence);
        return precedence <= parentPrecedence ? "(" + text + ")" : text;
      }
      case "binary": {
        if (value.op === "intersection" && !grammar.intersection)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: formula intersection in target grammar");
        const operator = value.op === "union" ? grammar.union : value.op === "intersection" ? grammar.intersection : value.op === ":" ? grammar.rangeSeparator ?? ":" : value.op;
        if (!canonical) return "(" + emit(value.left) + operator + emit(value.right) + ")";
        const precedence = ["=", "<>", "<", ">", "<=", ">="].includes(value.op) ? 1 : value.op === "&" ? 2 : ["+", "-"].includes(value.op) ? 3 : ["*", "/"].includes(value.op) ? 4 : value.op === "^" ? 5 : value.op === "union" ? 8 : value.op === "intersection" ? 9 : 10;
        let left = emit(value.left, value.op === "^" ? precedence : precedence - 1);
        if (value.op === "^" && (left.startsWith("-") || left.startsWith("+"))) left = "(" + left + ")";
        const text = left + operator + emit(value.right, precedence);
        return precedence <= parentPrecedence ? "(" + text + ")" : text;
      }
      case "array": return "{" + value.rows.map(row => row.map(child => child.kind === "unary" && child.child.kind === "literal" && child.child.value.kind === "number" ? child.op + String(child.child.value.value) : emit(child)).join(grammar.arrayColumn)).join(grammar.arrayRow) + "}";
      // Unknown function spelling is data and survives conversion without execution.
      case "call": {
        if (grammar.id === "odf" && value.args.length === 2 && ["R.DCHISQ","R.PCHISQ","R.QCHISQ"].includes(value.name))
          return (value.name === "R.QCHISQ" ? "CHISQINV" : "CHISQDIST") + "(" + value.args.map(child=>emit(child)).join(grammar.arguments) + (value.name === "R.DCHISQ" ? ";FALSE()" : "") + ")";
        if (grammar.id === "odf" && value.name === "EASTERSUNDAY" && value.args.length === 1) return "EASTERSUNDAY(" + emit(value.args[0]!) + ")";
        if (grammar.excelNumericHandlers) {
          const quantile = statisticsQuantileExports[value.name];
          if (quantile && value.args.length > quantile.parameters && value.args.length <= quantile.parameters + 3) {
            const n = quantile.parameters;
            const constant = (node: FormulaNode | undefined, fallback: boolean): boolean | undefined => node === undefined ? fallback : node.kind === "literal" && (node.value.kind === "number" || node.value.kind === "boolean") ? Boolean(node.value.value) : undefined;
            const lower = constant(value.args[n + 1],true), log = constant(value.args[n + 2],false);
            const call = (lower: boolean, log: boolean): string => {
              const right = !lower && quantile.rightName !== undefined;
              const probability = (!lower && !right ? "1-" : "") + (log ? "exp(" + emit(value.args[0]!) + ")" : emit(value.args[0]!));
              const args = value.args.slice(1,n + 1).map(child => emit(child));
              args.splice(quantile.probabilityIndex,0,probability);
              return (right ? quantile.rightName : quantile.name) + "(" + args.join(grammar.arguments) + ")";
            };
            const logarithmic = (tail: boolean) => log === undefined ? "if(" + emit(value.args[n + 2]!) + "," + call(tail,true) + "," + call(tail,false) + ")" : call(tail,log);
            return lower === undefined ? "if(" + emit(value.args[n + 1]!) + "," + logarithmic(true) + "," + logarithmic(false) + ")" : logarithmic(lower);
          }
          if (value.name === "HYPGEOMDIST" && value.args.length !== 5) return "_xlfn.HYPGEOM.DIST(" + value.args.map(child => emit(child)).concat("FALSE").join(grammar.arguments) + ")";

          if (value.name === "FLOOR" && value.args.length === 1) return "ROUNDDOWN(" + emit(value.args[0]!) + grammar.arguments + "0)";
          if (value.name === "ERF" && value.args.length !== 1) return "ERF(" + value.args.map(child => emit(child)).join(grammar.arguments) + ")";
        }
        if (grammar.odfRoundingArguments && (value.name === "FLOOR" || value.name === "CEILING")) {
          // Released writer's zero-argument handler emits this malformed spelling.
          if (!value.args.length) return value.name.toLowerCase() + "(" + value.name.toLowerCase() + "()";
          const x = emit(value.args[0]!);
          return value.name.toLowerCase() + "(" + x + grammar.arguments + (value.args[1] ? emit(value.args[1]) : "SIGN(" + x + ")") + grammar.arguments + "1)";
        }
        const nativeName = canonical && grammar.id === "gnumeric" && (Object.hasOwn(numericFunctionDescriptors, value.name) || Object.hasOwn(dateFinanceFunctionDescriptors, value.name) || Object.hasOwn(statisticsFunctionDescriptors,value.name))
          ? value.name.toLowerCase() : value.name;
        return (grammar.functionExportAliases?.[value.name] ?? (grammar === document.grammar && !canonical ? value.spelling : nativeName)) + "(" + value.args.map(child => emit(child)).join(grammar.arguments) + ")";
      }
    }
  }
  return (grammar.prefixes[0] ?? "=") + emit(document.root);
}
