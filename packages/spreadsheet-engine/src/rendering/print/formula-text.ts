import type {Cell, Sheet, Workbook} from "@poe-code/spreadsheet-ast";
import {SsconvertError, type CapabilityContext} from "../../contracts.js";
import {parseExpression} from "../../formulas/parser.js";
import {serializeExpression, quoteNativeSheet} from "../../formulas/serialization.js";
import {gnumericGrammar} from "../../formulas/conventions.js";
import {functionDescriptors} from "../../formulas/function-descriptors.js";
import {rendered} from "../../formulas/values.js";

// These core evaluator special forms do not use the plugin descriptor tables.
const coreFunctions = new Set(["IF", "SUM", "PRODUCT", "GNUMERIC_VERSION", "TABLE", "RAND"]);

/** Native formula view serializes the expression instead of echoing entered text. */
export function renderPrintFormula(book: Workbook, sheet: Sheet, cell: Pick<Cell, "row" | "column" | "formula" | "arrayStringLiterals">,
  context: CapabilityContext, tick: (amount?: number) => void): string | undefined {
  if (!cell.formula) return undefined;
  tick(cell.formula.length);
  const parsed = parseExpression(cell.formula, {position: {sheet: sheet.id, row: cell.row, column: cell.column},
    workbook: book, arrayStringLiterals: cell.arrayStringLiterals ?? false, signal: context.signal,
    maximumDepth: context.limits.formulaDepth, onWork: tick});
  if (!parsed.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: PDF formula expression syntax");
  const native = sheet.view?.gnumeric;
  const r1c1 = native && typeof native === "object" && !Array.isArray(native) &&
    (native as Readonly<Record<string, unknown>>).ExprConvention === "gnumeric:R1C1";
  const text = serializeExpression(parsed.document, {...gnumericGrammar, address: r1c1 ? "r1c1" : "a1", quoteSheetName: quoteNativeSheet}, false, true, {
    numberLiteral: value => rendered({kind: "number", value}),
    functionName: (name, spelling) => (coreFunctions.has(name) || Object.hasOwn(functionDescriptors, name)) ? name.toLowerCase() : spelling
  });
  tick(text.length);
  return text;
}
