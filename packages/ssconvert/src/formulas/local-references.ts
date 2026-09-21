import { DEFAULT_SHEET_SIZE, type Sheet, type Workbook } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { FormulaNode, ParsePosition } from "./ast.js";
import type { CalculationRange } from "./dependencies.js";

/** Resolve geometry only. Formula namespaces never acquire host capabilities. */
export function localReferenceRange(book: Workbook, node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition): CalculationRange | undefined {
  const first = node.first, last = node.last ?? first;
  if (first.workbook !== undefined || last.workbook !== undefined) return undefined;
  const resolve = (name?: string) => name === undefined ? book.sheets.find(sheet => sheet.id === position.sheet) :
    [...book.sheets, ...book.detachedSheets ?? []].find(sheet => foldSheetName(sheet.name) === foldSheetName(name));
  const a = resolve(first.sheet), b = resolve(last.sheet ?? first.sheet);
  if (!a || !b) return undefined;
  let sheets: readonly Sheet[] = [a];
  if (a !== b) {
    const x = book.sheets.indexOf(a), y = book.sheets.indexOf(b);
    if (x < 0 || y < 0) return undefined;
    sheets = book.sheets.slice(Math.min(x, y), Math.max(x, y) + 1);
  }
  const axis = (ref: typeof first, key: "row" | "column", end: boolean, sheet: Sheet) => ref[key] ? ref[key]!.value + (ref[key]!.relative ? position[key] : 0) : end ?
    (sheet.size ?? DEFAULT_SHEET_SIZE)[key === "row" ? "rows" : "columns"] - 1 : 0;
  const r1 = axis(first, "row", false, a), r2 = axis(last, "row", true, b), c1 = axis(first, "column", false, a), c2 = axis(last, "column", true, b);
  for (const sheet of sheets) {
    const size = sheet.size ?? DEFAULT_SHEET_SIZE;
    if (Math.min(r1, r2, c1, c2) < 0 || Math.max(r1, r2) >= size.rows || Math.max(c1, c2) >= size.columns) return undefined;
  }
  return { sheets, firstRow: Math.min(r1, r2), lastRow: Math.max(r1, r2), firstColumn: Math.min(c1, c2), lastColumn: Math.max(c1, c2) };
}
