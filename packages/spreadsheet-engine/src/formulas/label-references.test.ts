import { expect, it } from "vitest";
import type { Sheet, Workbook } from "@poe-code/spreadsheet-ast";
import { parseExpression } from "./parser.js";
import { resolveLabelReference } from "./label-references.js";
import type { FormulaNode } from "./ast.js";

const sheet: Sheet = { id: "S1", name: "S1", size: { rows: 65536, columns: 256 }, cells: [
  { row: 0, column: 0, value: { kind: "string", value: "Sales" } },
  ...[10, 20, 30].map((value, index) => ({ row: 0, column: index + 1, value: { kind: "number" as const, value } }))
] };
function resolve(source: string, target = sheet, position = { sheet: "S1", row: 2, column: 2 }) {
  const workbook: Workbook = { automaticLabelLookup: true, sheets: [target, { id: "S2", name: "S2", cells: [] }] };
  const parsed = parseExpression(source, { position, workbook });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  let node: FormulaNode = parsed.document.root;
  while (node.kind !== "reference") {
    if (node.kind === "unary" || node.kind === "parentheses") node = node.child;
    else if (node.kind === "call") node = node.args[0]!;
    else if (node.kind === "binary") node = node.left;
    else throw new Error("Expected label");
  }
  let work = 0;
  const value = resolveLabelReference(workbook, node, position,
    (s, row, column) => s.cells.find(cell => cell.row === row && cell.column === column)?.value ?? { kind: "blank" }, () => { work++; });
  return { value, work, scalar: node.label?.scalar };
}
it.each(["=SUM(-@row:$A1)", "=SUM(+@row:$A1)", "=SUM(@row:$A1%)", "=-@row:$A1%"])("selects a scalar beside unary operators: %s", source => {
  expect(resolve(source).scalar).toBe(true);
  expect(resolve(source).value).toMatchObject({ kind: "range", firstColumn: 2, lastColumn: 2 });
});
it("checks scalar intersection even for a declared singleton", () => {
  expect(resolve("=@row:$A1+1", { ...sheet, labelRanges: [{ axis: "row", labels: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, data: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 } }] }).value).toEqual({ kind: "error", value: "#REF!" });
});
it("rejects a scalar excluded by its own position", () => {
  expect(resolve("=@row:$A1+1", sheet, { sheet: "S1", row: 0, column: 2 }).value).toEqual({ kind: "error", value: "#REF!" });
});
it.each(["=@row:$IU1", "=@row:$IV1", "=SUM(@row:$IV1)", "=@column:A$65536", "=SUM(@column:A$65536)"])("rejects exhausted grid bounds: %s", source => {
  expect(resolve(source, { ...sheet, cells: [] }).value).toEqual({ kind: "error", value: "#REF!" });
});
it("does not exclude coordinates on a different sheet", () => {
  expect(resolve("=SUM(@row:S1!$A1)", sheet, { sheet: "S2", row: 0, column: 2 }).value).toMatchObject({ firstColumn: 1, lastColumn: 3 });
});
it.each([500, 1000])("bounds data-area work for %i contiguous cells", count => {
  const target = { ...sheet, cells: Array.from({ length: count }, (_, row) => ({ row, column: 0, value: row ? { kind: "number" as const, value: 1 } : { kind: "string" as const, value: "Sales" } })) };
  const result = resolve("=SUM(@column:A$1)", target);
  expect(result.value).toMatchObject({ firstRow: 1, lastRow: count - 1 });
  expect(result.work).toBeLessThan(count * 50);
});

it("checks singleton column intersections and permits the one matching row", () => {
  const target: Sheet = { ...sheet, cells: [], labelRanges: [{ axis: "column",
    labels: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    data: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } }] };
  expect(resolve("=@column:A$1", target).value).toEqual({ kind: "error", value: "#REF!" });
  expect(resolve("=@column:A$1", target, { sheet: "S1", row: 1, column: 2 }).value)
    .toMatchObject({ firstRow: 1, lastRow: 1 });
});
it("does not truncate a column label from another sheet", () => {
  const target = { ...sheet, cells: sheet.cells.map(cell => ({ ...cell, row: cell.column, column: cell.row })) };
  expect(resolve("=SUM(@column:S1!A$1)", target, { sheet: "S2", row: 2, column: 0 }).value)
    .toMatchObject({ firstRow: 1, lastRow: 3 });
});
it("rejects excluding the only remaining cell after a penultimate label", () => {
  expect(resolve("=SUM(@row:$IU1)", { ...sheet, cells: [] }, { sheet: "S1", row: 0, column: 255 }).value)
    .toEqual({ kind: "error", value: "#REF!" });
});
it("keeps array elements constant-only", () => {
  expect(parseExpression("={-@row:$A1}", { position: { sheet: "S1", row: 2, column: 2 } }).ok).toBe(false);
});
it("bounds work for horizontal data and ignores a remote disconnected cell", () => {
  const target: Sheet = { ...sheet, size: { rows: 100, columns: 2000 }, cells: [
    ...Array.from({ length: 1000 }, (_, column) => ({ row: 0, column, value: column ? { kind: "number" as const, value: 1 } : { kind: "string" as const, value: "Sales" } })),
    { row: 0, column: 1999, value: { kind: "number", value: 1 } }
  ] };
  const result = resolve("=SUM(@row:$A1)", target);
  expect(result.value).toMatchObject({ firstColumn: 1, lastColumn: 999 });
  expect(result.work).toBeLessThan(50000);
});
