import { DEFAULT_SHEET_SIZE, type CellRange, type CellValue, type Workbook } from "../../workbook.js";
import { parseExpression } from "../../formulas/parser.js";
import { rewriteReferences } from "../../formulas/rewriting.js";
import type { FormulaDocument, FormulaNode, ParsePosition } from "../../formulas/ast.js";
import { foldSheetName } from "../case-fold.js";

export type Expression =
  | { kind: "value"; value: CellValue }
  | { kind: "range"; range: CellRange; start: number; end: number; relative: { startRow: boolean; endRow: boolean; startColumn: boolean; endColumn: boolean } }
  | { kind: "name"; name: string; sheet?: string }
  | { kind: "unary"; op: string; child: Expression }
  | { kind: "binary"; op: string; left: Expression; right: Expression }
  | { kind: "call"; name: string; args: Expression[] }
  | { kind: "array"; rows: Expression[][] };

const documents = new WeakMap<Expression, FormulaDocument>();

/** Resolve the shared syntax tree for the bounded workbook evaluator. */
export function parseFormula(text: string, book: Workbook, sheet: string, onName?: (name: string, sheet?: string) => void,
  position: ParsePosition = { sheet, row: 0, column: 0 }): Expression | undefined {
  const resolve = (name?: string) => name === undefined ? book.sheets.find(s => s.id === sheet) :
    [...book.sheets, ...book.detachedSheets ?? []].find(s => foldSheetName(s.name) === foldSheetName(name));
  const unresolved = {};
  let parsed;
  try {
    parsed = parseExpression(text, { position, workbook: book, ...(onName ? { onName: (name: string, sheetName?: string) => {
      const target = resolve(sheetName);
      if (!target) throw unresolved;
      onName(name, sheetName === undefined ? undefined : target.id);
    } } : {}) });
  } catch (error) { if (error === unresolved) return undefined; throw error; }
  if (!parsed.ok) return undefined;
  function convert(node: FormulaNode): Expression {
    switch (node.kind) {
      case "literal": return { kind: "value", value: node.value };
      case "omitted": return { kind: "value", value: { kind: "blank" } };
      case "parentheses": return { kind: "unary", op: "()", child: convert(node.child) };
      case "unary": return { kind: "unary", op: node.op, child: convert(node.child) };
      case "binary": return { kind: "binary", op: node.op, left: convert(node.left), right: convert(node.right) };
      case "array": return { kind: "array", rows: node.rows.map(row => row.map(convert)) };
      case "call": return { kind: "call", name: node.name, args: node.args.map(convert) };
      case "name": {
        const target = resolve(node.sheet);
        if (node.workbook !== undefined || !target) throw unresolved;
        return { kind: "name", name: node.name, ...(node.sheet ? { sheet: target.id } : {}) };
      }
      case "reference": {
        const first = node.first, last = node.last ?? first;
        const a = resolve(first.sheet), b = resolve(last.sheet ?? first.sheet);
        if (first.workbook !== undefined || last.workbook !== undefined || !a || !b) throw unresolved;
        const axis = (ref: typeof first, kind: "row" | "column", end: boolean, size: number) => {
          const value = ref[kind]; return value ? value.value + (value.relative ? position[kind] : 0) : end ? size - 1 : 0;
        };
        const startRow = axis(first, "row", false, (a.size ?? DEFAULT_SHEET_SIZE).rows);
        const endRow = axis(last, "row", true, (b.size ?? DEFAULT_SHEET_SIZE).rows);
        const startColumn = axis(first, "column", false, (a.size ?? DEFAULT_SHEET_SIZE).columns);
        const endColumn = axis(last, "column", true, (b.size ?? DEFAULT_SHEET_SIZE).columns);
        if (Math.min(startRow, endRow, startColumn, endColumn) < 0 || startRow >= (a.size ?? DEFAULT_SHEET_SIZE).rows ||
          startColumn >= (a.size ?? DEFAULT_SHEET_SIZE).columns || endRow >= (b.size ?? DEFAULT_SHEET_SIZE).rows ||
          endColumn >= (b.size ?? DEFAULT_SHEET_SIZE).columns) throw unresolved;
        return { kind: "range", start: node.start, end: node.end,
          range: { sheet: a.id, ...(a.id !== b.id ? { endSheet: b.id } : {}),
            startRow: Math.min(startRow, endRow), endRow: Math.max(startRow, endRow),
            startColumn: Math.min(startColumn, endColumn), endColumn: Math.max(startColumn, endColumn) },
          relative: { startRow: first.row?.relative ?? false, endRow: last.row?.relative ?? false,
            startColumn: first.column?.relative ?? false, endColumn: last.column?.relative ?? false } };
      }
    }
  }
  try { const result = convert(parsed.document.root); documents.set(result, parsed.document); return result; }
  catch (error) { if (error === unresolved) return undefined; throw error; }
}

export function visitExpression(node: Expression, visit: (node: Expression) => void): void {
  visit(node);
  if (node.kind === "unary") visitExpression(node.child, visit);
  if (node.kind === "binary") { visitExpression(node.left, visit); visitExpression(node.right, visit); }
  if (node.kind === "call") for (const arg of node.args) visitExpression(arg, visit);
  if (node.kind === "array") for (const row of node.rows) for (const child of row) visitExpression(child, visit);
}

export function relocateFormula(text: string, node: Expression, row: number, column: number): string {
  const document = documents.get(node);
  if (!document || document.source !== text) throw new TypeError("Formula relocation requires its parsed source");
  return rewriteReferences(document, { translation: "copy", position: { ...document.position,
    row: document.position.row + row, column: document.position.column + column } });
}
