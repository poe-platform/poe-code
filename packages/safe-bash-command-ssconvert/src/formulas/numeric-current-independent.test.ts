import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each<[string, number]>([
  ["=EXP(-1.1)", 0.33287108369807955],
  ["=ILOG(0.5,4)", 0],
  ["=ILOG(0.125,4)", -1],
  ["=ILOG(0.0625,8)", -1],
  ["=ILOG(0.5,2)", -1],
  ["=ILOG(0.5,3)", -1],
  ["=ODD(9007199254740992)", 9007199254740992],
  ["=ODD(-9007199254740992)", -9007199254740992],
  ["=ODD(4503599627370497)", 4503599627370497],
  ["=ODD(0)", 1],
  ["=ODD(-2.25)", -3],
  ["=EVEN(FLT.NEXTAFTER(0,1))", 2],
  ["=EVEN(-FLT.NEXTAFTER(0,1))", -2]
])("preserves released scalar integer branch %s", (formula, value) => {
  const workbook = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, {
    signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1,
      operations: 10, workbookWork: 10000 }, own() {}
  });
  expect(workbook.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value });
});
