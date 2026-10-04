import {DEFAULT_SHEET_SIZE, type Cell, type Sheet, type Workbook} from "@poe-code/spreadsheet-ast";
import {SsconvertError, type CapabilityContext} from "../../contracts.js";
import {parseExpression} from "../../formulas/parser.js";
import {serializeExpression, serializeReference, quoteNativeSheet} from "../../formulas/serialization.js";
import {gnumericGrammar} from "../../formulas/conventions.js";
import {functionDescriptors} from "../../formulas/function-descriptors.js";
import {localReferenceRange} from "../../formulas/local-references.js";
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
  const r1c1 = sheet.view?.referenceMode === "R1C1" || sheet.view?.referenceMode !== "A1" &&
    native && typeof native === "object" && !Array.isArray(native) &&
    (native as Readonly<Record<string, unknown>>).ExprConvention === "gnumeric:R1C1";
  const grammar = {...gnumericGrammar, address: r1c1 ? "r1c1" as const : "a1" as const, quoteSheetName: quoteNativeSheet};
  const position = parsed.document.position;
  const text = serializeExpression(parsed.document, grammar, false, true, {
    reference: node => {
      let first = {...node.first}, last = node.last ? {...node.last} : undefined;
      if (first.row && first.column && last?.row && last.column) {
        tick(4 * (book.sheets.length + (book.detachedSheets?.length ?? 0)));
        const range = localReferenceRange(book, node, position);
        if (range) {
          const size = range.sheets[range.sheets.length - 1]!.size ?? DEFAULT_SHEET_SIZE;
          // A1 uses normalized coordinates with the original relativity flags;
          // R1C1 displays the original offsets even when endpoints are reversed.
          if (!r1c1) {
            first = {...first, row: {...first.row, value: range.firstRow - (first.row.relative ? position.row : 0)},
              column: {...first.column, value: range.firstColumn - (first.column.relative ? position.column : 0)}};
            last = {...last, row: {...last.row, value: range.lastRow - (last.row.relative ? position.row : 0)},
              column: {...last.column, value: range.lastColumn - (last.column.relative ? position.column : 0)}};
          }
          // Native prefers whole rows when both axes cover the sheet.
          if (range.firstColumn === 0 && range.lastColumn === size.columns - 1) {
            delete first.column; delete last.column;
          } else if (range.firstRow === 0 && range.lastRow === size.rows - 1) {
            delete first.row; delete last.row;
          }
        }
      }
      return serializeReference(first, last, grammar, position);
    },
    numberLiteral: value => rendered({kind: "number", value}),
    functionName: (name, spelling) => (coreFunctions.has(name) || Object.hasOwn(functionDescriptors, name)) ? name.toLowerCase() : spelling
  });
  tick(text.length);
  return text;
}
