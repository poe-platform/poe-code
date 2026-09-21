import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { capturedTrig } from "./functions/captured-trigonometry.js";

it.each<[string, number]>([
  ["=BESSELJ(100,1)", -.07714535201411217],
  ["=BESSELY(100,1)", -.0203723120027598],
  ["=BESSELY(17,0.000001)", -.09263693163577924],
  ["=BESSELJ(31,1)", -.13302431666631426],
  ["=BESSELJ(31,-0.125)", .07636450450395983],
  ["=BESSELY(19,2)", .09377652150506217],
  ["=BESSELY(17,0.5)", .05324835186521753],
  ["=BESSELJ(16.999999999999996,1.9999999999999998)", .15836384123850347],
  ["=BESSELJ(1000,920)", -.00843214138122377]
])("preserves the captured integer Bessel phase %s", (formula, expected) => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "Original", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { cells: 1, sheets: 1, inputBytes: 1000, outputBytes: 1000, operations: 10, workbookWork: 10000 }, own() {} });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});

it("preserves the captured cosine correction at a near-zero Bessel phase", () => {
  expect(capturedTrig(16.47843003632959, true)).toBe(-.7175856574981382);
});

it("preserves the captured small sine Taylor contraction after cosine reduction", () => {
  expect(capturedTrig(137330.13360794372, true)).toBe(.12283423768878389);
});

it("preserves overflow multiplied by zero in negative integer reflection", () => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "Original", cells: [
    { row: 0, column: 0, formula: "=BESSELJ(1,-200)", formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { cells: 1, sheets: 1, inputBytes: 1000, outputBytes: 1000, operations: 10, workbookWork: 10000 }, own() {} });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NUM!" });
});
