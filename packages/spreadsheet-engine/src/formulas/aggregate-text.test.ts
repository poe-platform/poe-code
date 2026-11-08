import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each([
  ['COUNT("2")', 1], ['COUNT(1,"2",3)', 3], ['COUNT("x")', "#VALUE!"],
  ['COUNT(1,"x",2)', "#VALUE!"], ['SUM(1,"x",2)', "#VALUE!"],
  ['AVERAGE(1,"x",2)', "#VALUE!"], ['SUM(1,"2",3)', 6], ['AVERAGE(1,"6",2)', 3],
  ['COUNT(1,2)', 2], ['COUNT(A1)', 0], ['SUM(A1)', 0], ['AVERAGE(A1)', "#DIV/0!"],
  ['COUNT(A2)', 0], ['SUM(A2)', 0], ['AVERAGE(A2)', "#DIV/0!"],
  ['COUNT(A1:A3)', 1], ['SUM(A1:A3)', 4], ['AVERAGE(A1:A3)', 4],
  ['COUNT({"x",4})', 1], ['SUM({"x",4})', 4], ['AVERAGE({"x",4})', 4],
  ['COUNT(1/0)', 0], ['COUNTA("x")', 1], ['AVERAGEA("x",2)', 1],
  ['PRODUCT("2",3)', 6], ['PRODUCT("x",3)', "#VALUE!"],
] as const)("evaluates direct and referenced aggregate text in %s", (expression, value) => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "x" } },
    { row: 1, column: 0, value: { kind: "string", value: "2" } },
    { row: 2, column: 0, value: { kind: "number", value: 4 } },
    { row: 0, column: 1, formula: `=${expression}`, value: { kind: "blank" } }
  ] }] }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  expect(book.sheets[0]!.cells.at(-1)!.value).toEqual({ kind: typeof value === "number" ? "number" : "error", value });
});
