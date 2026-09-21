import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, CellValue } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
const source: readonly [number, CellValue][] = [
  [0, { kind: "string", value: "alpha" }], [1, { kind: "string", value: "alphabet" }],
  [2, { kind: "string", value: "ALPHA" }], [3, { kind: "number", value: 0 }],
  [5, { kind: "string", value: "" }], [6, { kind: "error", value: "#DIV/0!" }],
  [7, { kind: "boolean", value: true }], [8, { kind: "string", value: "2" }],
];
it.each<[string, number | string]>([
  ['=COUNTIF(A1:A9,"alpha")', 2], ['=COUNTIF(A1:A9,"alpha*")', 3],
  ['=COUNTIF(A1:A9,"")', 2], ['=COUNTIF(A1:A9,"=")', 1],
  ['=COUNTIF(A1:A9,D1)', 0], ['=COUNTIFS(A1:A9,D1)', 1],
  ['=COUNTIF(A1:A9,"*")', 5], ['=COUNTIF(A1:A9,"<>")', '#DIV/0!'],
  ['=COUNTIF(A1:A9,"<>0")', '#DIV/0!'], ['=COUNTIF(A1:A9,"2")', 1],
  ['=COUNTIF(A1:A9,TRUE)', 1], ['=COUNTIFS(A1:A9,"alpha",B1:B8,">0")', '#VALUE!'],
  ['=SUMIF(A1:A9,"alpha",B1:B8)', '#VALUE!'], ['=SUMIFS(B1:B9,A1:A9,"alpha")', 4],
  ['=AVERAGEIFS(B1:B9,A1:A9,"nomatch")', '#DIV/0!'],
  ['=MINIFS(B1:B9,A1:A9,"nomatch")', '#DIV/0!'],
  ['=SUMIFS({1,2},A1:A2,"alpha")', '#VALUE!'],
  ['=COUNTIFS({"alpha","alphabet"},"alpha")', 1],
  ['=SUMIF(A1:A9,"=alpha*",B1:B9)', 0], ['=COUNTIF(A1:A9,A7)', '#DIV/0!'],
  ['=SUMIFS(B1:B9)', 45], ['=MINIFS(B1:B9)', 1], ['=MAXIFS(B1:B9)', 9],
  ['=AVERAGEIFS(B1:B9)', 5], ['=COUNTIFS()', '#VALUE!'],
  ['=MAXIFS(B1:B9,A1:A9,"nomatch")', '#DIV/0!'],
  ['=SUMIFS(A1:A9,B1:B9,">0")', '#DIV/0!'],
])("conditional independent review %s", (formula, expected) => {
  const cells: Cell[] = [...source.map(([row, value]) => ({ row, column: 0, value })),
    ...Array.from({ length: 9 }, (_, row): Cell => ({ row, column: 1, value: { kind: "number", value: row + 1 } })),
    { row: 0, column: 5, formula, formulaDirty: true, value: { kind: "number", value: 0 } }];
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells }] }, context);
  expect(result.sheets[0]!.cells.at(-1)!.value).toEqual({ kind: typeof expected === "number" ? "number" : "error", value: expected });
  expect(result.sheets[0]!.cells.some(cell => cell.column === 0 && cell.row === 4)).toBe(false);
});
