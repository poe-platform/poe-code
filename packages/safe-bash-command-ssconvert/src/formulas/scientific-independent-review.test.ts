import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, number]>([
  ["=GAMMA(1.5)", .886226925452758],
  ["=GAMMA(2.5)", 1.329340388179137],
  ["=GAMMA(-171.5)", 1.9316265431712e-310],
  ["=GAMMA(-172.5)", -1.11978350329e-312],
  ["=POCHHAMMER(1e20,.5)", 1e10],
  ["=POCHHAMMER(-3,.5)", 0],
  ["=DIGAMMA(-.5)", .03648997397857653],
  ["=LAMBERTW(1e-300)", 1e-300],
])("independent numerical regression %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context);
  const value = result.sheets[0]!.cells[0]!.value;
  expect(value.kind).toBe("number");
  if (expected !== 0 && value.kind === "number") expect(Math.abs((value.value - expected) / expected)).toBeLessThan(2e-11);
  if (expected === 0 && value.kind === "number") expect(value.value).toBe(0);
});
it.each(["=BETA(1,1e300)", "=LAMBERTW(1e300)", "=LAMBERTW(-1e-300,-1)"])("preserves native intermediate overflow %s", formula => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NUM!" });
});
it.each<[string, number]>([
  ['=LAMBERTW(-0.3678794411714423)', -.9999999845821744],
  ['=LAMBERTW(-0.3678794411714423,-1)', -1.0000000122398298],
])("preserves pinned native fused branchpoint evaluation %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});
