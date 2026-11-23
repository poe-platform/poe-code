import { expect, it } from "vitest";
import { recalculateWorkbook } from "../evaluator.js";

it.each([
  [2400, 0, 0.15, 4294967296, 0],
  [-2400, -5000, 0.15, 4294967296, 0],
  [2400, 0, 0, 4294967296, 0],
  [2400, 0, 0.15, 0, 900],
  [2400, 0, 0.15, 1, 562],
  [2400, 0, 0.15, 2, 352],
  [2400, 2000, 0, 1, 0],
  [2400, 3000, 0, 1, 1200],
  [2400, 3000, 0, 2, 0],
])("AMORDEGRC(%s, dates, %s, rate %s, period %s) settles without redundant periods", (cost, salvage, rate, period, expected) => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0,
    formula: `=AMORDEGRC(${cost},43831,44196,${salvage},${period},${rate},0)`, value: { kind: "blank" },
  }] }] }, {
    signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 1000, workbookWork: 10000 },
  }, true);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});
