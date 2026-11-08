import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function calculate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}
it.each<[string, number]>([
  ['=IMREAL(IMIGAMMA("1+i","50+i",FALSE,TRUE))', -3.6102258005726786e-22],
  ['=IMAGINARY(IMIGAMMA("1+i","50+i",FALSE,TRUE))', -3.326553293976447e-23],
  ['=IMREAL(IMIGAMMA(0.5,-50,TRUE,TRUE))', 0],
  ['=IGAMMA(1,1e-20)', 1e-20],
])("repairs original incomplete gamma boundary %s", (formula, expected) => {
  const actual = calculate(formula);
  expect(actual.kind).toBe("number");
  if (actual.kind === "number") {
    if (expected === 0) expect(actual.value).toBe(0);
    else expect(Math.abs(actual.value - expected)).toBeLessThanOrEqual(Math.abs(expected) * 32 * Number.EPSILON);
  }
});
it("formats incomplete gamma using its second complex argument's unit", () => {
  const actual = calculate('=IMIGAMMA("1+i","50+j",FALSE,TRUE)');
  expect(actual.kind).toBe("string");
  if (actual.kind === "string") expect(actual.value.endsWith("j")).toBe(true);
});
it("uses the released factorial multiplication path", () => {
  expect(calculate('=IMAGINARY(IMFACT("1+i"))')).toEqual({ kind: "number", value: .3430658398165455 });
});
it.each<[string, string]>([
  ['=IMIGAMMA("1+i","50+i",FALSE,TRUE)', '-3.6102258005726786E-22-3.326553293976447E-23i'],
  ['=IMIGAMMA("1+i","50+i",TRUE,TRUE)', '1+3.326553293976447E-23i'],
  ['=IMFACT("1+i")', '0.6529654964201668+0.3430658398165455i'],
  ['=IMGAMMA("-1+i")', '-0.17153291990827269+0.3264827482100833i'],
  ['=IMIGAMMA("1+i","50+i",TRUE,FALSE)', '1-3.9373630180640355E-23i'],
])("retains the released complex field %s", (formula, expected) => {
  expect(calculate(formula)).toEqual({ kind: "string", value: expected });
});
it("avoids cancellation in the positive incomplete gamma prefactor", () => {
  const actual = calculate('=IGAMMA(1000,1000)');
  expect(actual.kind).toBe("number");
  if (actual.kind === "number") expect(Math.abs(actual.value - .5042052441802155)).toBeLessThanOrEqual(2 * Number.EPSILON);
});
it("retains the native rounded positive gamma result near its mean", () => {
  expect(calculate('=IGAMMA(1000,1000)')).toEqual({ kind: "number", value: .5042052441802155 });
});
it.each(['=IMGAMMA(0)', '=IMFACT(-1)', '=IGAMMA(-1,1,TRUE,FALSE)', '=IMIGAMMA("1+i",0)'])(
  "preserves source pole/failure %s", formula => {
    expect(calculate(formula)).toEqual({ kind: "error", value: "#NUM!" });
  }
);
it.each<[string, number]>([
  ['=IGAMMA(0,0)', 1],
  ['=IGAMMA(2,0,TRUE,FALSE)', 0],
  ['=IGAMMA(2,0,FALSE,FALSE)', 1],
  ['=IGAMMA(1000,1000,FALSE,TRUE)', .4957947558197845],
  ['=IMREAL(IMIGAMMA("1+i","50+i",TRUE,FALSE))', 1],
])("preserves released flag and degenerate behavior %s", (formula, expected) => {
  expect(calculate(formula)).toEqual({ kind: "number", value: expected });
});
