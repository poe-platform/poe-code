import { expect, it } from "vitest";
import proof from "../../../../docs/ssconvert/python-printf-gap-proof.json" with { type: "json" };
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { pythonSampleFunctions } from "./optional-providers.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  runtimeFunctions: pythonSampleFunctions, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 1000 } };
const calculate = (formula: string, overrides: Partial<CapabilityContext> = {}) =>
  recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, { ...context, ...overrides }).sheets[0]!.cells[0]!.value;
it.each(proof.cases)("formats exact independent Python case $id", fixture => {
  expect(calculate(fixture.formula)).toEqual(fixture.expected);
});
it.each(proof.native.mismatches)("matches activated native exception case $id", fixture => {
  const original = proof.cases.find(row => row.id === fixture.id)!;
  expect(calculate(original.formula)).toEqual({ kind: "error", value: fixture.actual });
});
it("preserves optional activation and refuses explosive precision before output", () => {
  expect(calculate('=PY_PRINTF("%s","Ada")', { runtimeFunctions: {} })).toEqual({ kind: "error", value: "#NAME?" });
  expect(() => calculate('=PY_PRINTF("%.999999f",1)', { limits: { ...context.limits, outputBytes: 100 } }))
    .toThrow("text limit");
});

it("retains source loader zero-argument and error-to-None behavior", () => {
  expect(calculate('=PY_PRINTF()')).toEqual({ kind: "error", value: "Python exception (<class 'TypeError'>: func_printf() missing 1 required positional argument: 'format')" });
  expect(calculate('=PY_PRINTF(17,1)')).toEqual({ kind: "error", value: "Python exception (<class 'Gnumeric.GnumericError'>: #VALUE!)" });
  const diagnostics: string[] = [];
  // Error values are Python None rather than propagated by the native node function.
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: '=PY_PRINTF("%s",NA())', formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context, true, d => { diagnostics.push(d.message); });
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "None" });
  expect(diagnostics).toEqual(["gnm_value_to_py_obj: unsupported value type"]);
});
it("formats source loader column-major arrays without scalar coercion", () => {
  expect(calculate('=PY_PRINTF("%s",{1,2;3,4})')).toEqual({ kind: "string", value: "[[1.0, 3.0], [2.0, 4.0]]" });
});
it("normalizes empty scalar arguments to zero before loader conversion, preserving empty array elements", () => {
  expect(calculate('=PY_PRINTF("%s",A2)')).toEqual({ kind: "string", value: "0.0" });
  expect(calculate('=PY_PRINTF("%f",A2)')).toEqual({ kind: "string", value: "0.000000" });
  expect(calculate('=PY_PRINTF("%s",TRANSPOSE(A2:B2))')).toEqual({ kind: "string", value: "[[None, None]]" });
});
it("keeps unqualified native pointer representations explicit", () => {
  expect(() => calculate('=PY_PRINTF("%r",A2:B3)')).toThrow("Python RangeRef object representation");
});
it("charges formatting work and stops when a loader diagnostic cancels the invocation", () => {
  expect(() => calculate('=PY_PRINTF("%.120f",1)', { limits: { ...context.limits, workbookWork: 50 } }))
    .toThrow("work limit exceeded");
  const controller = new AbortController(), reason = new Error("stop Python conversion");
  expect(() => recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: '=PY_PRINTF("%s",NA())', formulaDirty: true, value: { kind: "blank" } }
  ] }] }, { ...context, signal: controller.signal }, true, () => { controller.abort(reason); }))
    .toThrow(reason);
});
