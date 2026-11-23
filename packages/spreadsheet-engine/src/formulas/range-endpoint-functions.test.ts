import { expect, it } from "vitest";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { parseExpression } from "./parser.js";
import { recalculateWorkbook } from "./evaluator.js";

it.each(["INDEX(A1:B2,2,2)", "INDEX (A1:B2,2,2)", "IF(TRUE,B2,A1)"])("calculates a range ending at %s", endpoint => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...[1, 2, 10, 20].map((value, i) => ({ row: Math.floor(i / 2), column: i % 2, value: { kind: "number" as const, value } })),
    { row: 3, column: 0, value: { kind: "blank" }, formula: `=SUM(A1:${endpoint})`, formulaDirty: true }
  ] }] };
  const result = recalculateWorkbook(book, {
    signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 }
  });
  expect(result.sheets[0]!.cells[4]!.value).toEqual({ kind: "number", value: 33 });
  expect(book.sheets[0]!.cells[4]!.value).toEqual({ kind: "blank" });
});

it.each(["INDEX(A1:B2,2,2)", "LOG2(B2)"])("retains %s as a function after a range operator", endpoint => {
  const parsed = parseExpression(`=A1:${endpoint}`, { position: { sheet: "s", row: 0, column: 0 } });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.document.root).toMatchObject({ kind: "binary", op: ":", right: { kind: "call" } });
});
