import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { pythonSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 1000 },
  runtimeFunctions: pythonSampleFunctions, own() {}
};
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}

it("ports the shipped Python capwords sample with whitespace normalization and whole-word capitalization", () => {
  expect(calculate('=PY_CAPWORDS("  hELLO\tWORLD  don\'t STOP foo-BAR 123ABC  ")'))
    .toEqual({ kind: "string", value: "Hello World Don't Stop Foo-bar 123abc" });
  expect(calculate('=PY_CAPWORDS("")')).toEqual({ kind: "string", value: "" });
});

it("retains the optional namespace and typed arity/error behavior", () => {
  expect(calculate('=PY_CAPWORDS("hello")', { ...context, runtimeFunctions: {} }))
    .toEqual({ kind: "error", value: "#NAME?" });
  expect(calculate('=PY_CAPWORDS()')).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate('=PY_CAPWORDS(1/0)')).toEqual({ kind: "error", value: "#DIV/0!" });
});

it("keeps unqualified Unicode semantics explicitly unsupported and enforces text/work budgets", () => {
  expect(() => calculate('=PY_CAPWORDS("straße")')).toThrow("Unicode");
  expect(() => calculate('=PY_CAPWORDS("hello")', { ...context, limits: { ...context.limits, outputBytes: 4 } }))
    .toThrow("text limit");
  expect(() => calculate('=PY_CAPWORDS("hello world")', { ...context, limits: { ...context.limits, workbookWork: 1 } }))
    .toThrow();
});
