import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { sinPi } from "./functions/math.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function evaluate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula,
    formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
}
it.each(["=GCD(0,0)", '=GCD("skip")', "=GCD(4503599627370497,2)", "=LCM(0,2)", '=LCM("skip")', "=FIB(1476)", "=RADIANS(1e308)", "=AGM(1e-300,1e300)"])("enforces pinned collection/boundary errors for %s", formula => {
  expect(evaluate(formula)).toEqual({ kind: "error", value: "#NUM!" });
});
it.each<[string, number]>([
  ["=GCD(-5e-324,2)", 2], ["=HYPOT(1e-300,1e-300)", 1.414213562373095e-300],
  ["=FACT(170)", 7.257415615307999e306], ["=FACTDOUBLE(300)", 8.154414069380594e307],
  ["=FACT(.5)", 0.886226925452758], ["=FACT(-.5)", 1.772453850905516],
  ["=MROUND(1.7,.2)", 1.6], ["=MROUND(-1.7,-.2)", -1.6],
  ["=COMBIN(2.9999999999999996,2)", 1], ["=COMBINA(2.9999999999999996,2)", 3],
  ["=COMBIN(100,30)", 2.9372339821610947e25], ["=COMBIN(1000,300)", 5.428250046406141e263],
  ["=COMBIN(1e300,1)", 1e300], ["=GCD(4503599627370496,2)", 2], ["=FIB(78)", 8944394323791488],
  ["=FIB(100)", 3.542248481792631e20], ["=SINPI(.25)", 0.7071067811865476],
  ["=COSPI(.25)", 0.7071067811865476], ["=COSPI(1e-20)", 1],
  ["=ROUND(1.2345678901234567,17)", 1.2345678901234567],
  ["=ROUND(1e-310,320)", 1e-310], ["=ROUNDUP(1e-310,320)", 1e-310],
  ["=TRUNC(1e-310,320)", 9.999999999e-311]
])("matches independently chosen numeric edge %s", (formula, expected) => {
  expect(evaluate(formula)).toEqual({ kind: "number", value: expected });
});
it("preserves the sign of integral sinpi results before cell normalization", () => {
  expect(Object.is(sinPi(-2), -0)).toBe(true);
});
