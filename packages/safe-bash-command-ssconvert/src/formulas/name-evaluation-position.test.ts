import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { NamedExpression, Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { setCellText } from "../workbook/updates/index.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 10000 } };
function input(formula: string, names: readonly NamedExpression[]): Workbook {
  return { names, sheets: ["Here", "Data"].map((name, index) => ({ id: name, name,
    cells: [...Array.from({ length: 8 }, (_, row) => Array.from({ length: 3 }, (_, column) => ({ row, column,
      value: { kind: "number" as const, value: (index + 1) * 1000 + row * 10 + column + 1 } }))).flat(),
      ...(index === 0 ? [{ row: 4, column: 4, formula, value: { kind: "number" as const, value: 999 }, cachedResult: { kind: "number" as const, value: 999 }, formulaDirty: false }] : [])] })) };
}
const position = { sheet: "Data", row: 2, column: 2 };
function result(book: Workbook, force = true) {
  return recalculateWorkbook(book, context, force).sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 4)!.value;
}

it.each([
  ["$B$1", 1002], ["A1", 1023], ["$B1", 1022], ["A$2", 1013], ["Data!A1", 2023], ["ROW()", 5], ["COLUMN()", 5]
] as const)("evaluates local %s at the caller while parsing relative axes at the definition", (expression, value) => {
  const book = input("=Data!Target", [{ name: "Target", expression, sheet: "Data", position }]);
  expect(result(book)).toEqual({ kind: "number", value });
});

it("uses A1 as the omitted definition position for relative named references", () => {
  expect(result(input("=Target", [{ name: "Target", expression: "C3" }]))).toEqual({ kind: "number", value: 0 });
});

it("uses the caller sheet for global names even when their stored parse position names another sheet", () => {
  expect(result(input("=[]Target", [{ name: "Target", expression: "$B$1", position }]))).toEqual({ kind: "number", value: 1002 });
});

it.each([
  ["=Data!Outer", "Data", "Inner+$B$1", 1005],
  ["=[]Outer", undefined, "Inner+$B$1", 1007],
  ["=Data!Outer", "Data", "Here!Inner+$B$1", 1004],
  ["=Data!Outer", "Data", "[]Inner+$B$1", 1007]
] as const)("binds nested names in the definition's namespace for %s / %s / %s", (formula, sheet, expression, value) => {
  const names: NamedExpression[] = [{ name: "Inner", expression: "5" },
    { name: "Inner", expression: "2", sheet: "Here" }, { name: "Inner", expression: "3", sheet: "Data" },
    { name: "Outer", expression, position, ...(sheet === undefined ? {} : { sheet }) }];
  expect(result(input(formula, names))).toEqual({ kind: "number", value });
});

it("resolves INDIRECT names with caller geometry and definition parse coordinates", () => {
  expect(result(input('=INDIRECT("Data!Target")', [{ name: "Target", expression: "A1", sheet: "Data", position }]))).toEqual({ kind: "number", value: 1023 });
});

it.each(["=Data!Target", '=INDIRECT("Data!Target")'])("links the caller-sheet named precedent for %s", formula => {
  const book = input(formula, [{ name: "Target", expression: "$B$1", sheet: "Data", position }]);
  const updated = { ...book, sheets: book.sheets.map(sheet => sheet.id !== "Here" ? sheet : { ...sheet,
    cells: sheet.cells.map(cell => cell.row === 0 && cell.column === 1 ? { ...cell, formula: "=41", formulaDirty: true } : cell) }) };
  expect(result(updated, false)).toEqual({ kind: "number", value: 41 });
});

it("marks caller-sheet named dependents dirty during workbook updates", () => {
  const book = input("=Data!Target", [{ name: "Target", expression: "$B$1", sheet: "Data", position }]);
  const updated = setCellText(book, { sheet: "Here", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, "41", context);
  expect(updated.sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 4)?.formulaDirty).toBe(true);
});
