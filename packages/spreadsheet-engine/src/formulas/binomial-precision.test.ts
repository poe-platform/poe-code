import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }
};
function calculate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}

it.each([
  ["=R.DBINOM(2,4,0.5)", 0.375],
  ["=R.PBINOM(2,4,0.5)", 0.6875],
  ["=R.PBINOM(2,4,0.5,FALSE)", 0.3125],
  ["=BINOM.DIST.RANGE(4,0.5,1,2)", 0.625],
  ["=CRITBINOM(4,0.5,0.6875)", 2],
  ["=BINOMDIST(2.9,4.9,0.5,FALSE)", 0.375],
  ["=BINOMDIST(0,0,0.5,FALSE)", 1],
  ["=BINOMDIST(0,4,0,FALSE)", 1],
  ["=BINOMDIST(1,4,0,FALSE)", 0],
  ["=BINOMDIST(4,4,1,FALSE)", 1],
  ["=BINOMDIST(3,4,1,TRUE)", 0],
  ["=BINOMDIST(4,4,1,TRUE)", 1],
] as const)("preserves shared binomial callers and boundaries: %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "number", value });
});

it.each(["=BINOMDIST(-1,4,0.5,FALSE)", "=BINOMDIST(5,4,0.5,FALSE)",
  "=BINOMDIST(1,4,-0.1,FALSE)", "=BINOMDIST(1,4,1.1,TRUE)"])("rejects invalid arguments: %s", formula => {
  expect(calculate(formula)).toEqual({ kind: "error", value: "#NUM!" });
});

it.each([
  ["=R.DBINOM(2,4,0.5,TRUE)", Math.log(0.375)],
  ["=R.PBINOM(2,4,0.5,TRUE,TRUE)", Math.log(0.6875)],
  ["=BINOMDIST(100,200,0.5,FALSE)", 0.05634847900925642],
  ["=BINOMDIST(100,200,0.5,TRUE)", 0.5281742395046282],
  ["=BINOMDIST(1,170,1e-200,FALSE)", 1.7e-198]
] as const)("retains logarithmic and large-count evaluation: %s", (formula, expected) => {
  const value = calculate(formula);
  expect(value.kind).toBe("number");
  if (value.kind === "number") expect(value.value / expected).toBeCloseTo(1, 12);
});
