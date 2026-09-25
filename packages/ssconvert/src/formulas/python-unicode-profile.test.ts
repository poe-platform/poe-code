import { expect, it } from "vitest";
import proof from "../../../../docs/ssconvert/capwords-cstring-gap-proof.json" with { type: "json" };
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { createPythonSampleFunctions, pythonSampleFunctions } from "./optional-providers.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, runtimeFunctions: pythonSampleFunctions,
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 } };
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}

it.each(proof.widePython312.differences)("matches Unicode 15 CAPWORDS case $id", fixture => {
  expect(calculate(fixture.formula, { ...context, runtimeFunctions: createPythonSampleFunctions({ unicodeVersion: "15.0.0" }) }))
    .toEqual({ kind: "string", value: fixture.python312 });
  expect(calculate(fixture.formula)).toEqual({ kind: "string", value: fixture.native });
});

it.each([
  ["\u1c89", "'\\u1c89'"], ["\u{10d50}", "'\\U00010d50'"], ["\u{1cc00}", "'\\U0001cc00'"]
])("uses the selected Unicode printable properties for %s", (source, escaped) => {
  const supplied = { ...context, runtimeFunctions: createPythonSampleFunctions({ unicodeVersion: "15.0.0" }) };
  expect(calculate(`=PY_PRINTF("%r","${source}")`, supplied)).toEqual({ kind: "string", value: escaped });
  expect(calculate(`=PY_PRINTF("%r","${source}")`)).toEqual({ kind: "string", value: `'${source}'` });
  expect(calculate(`=PY_PRINTF("%a","${source}")`, supplied)).toEqual({ kind: "string", value: escaped });
  expect(calculate(`=PY_PRINTF("%s","${source}")`, supplied)).toEqual({ kind: "string", value: source });
});

it.each(["15.0.0", "16.0.0"] as const)("retains errors, NUL handling, budgets and binding snapshots for %s", unicodeVersion => {
  const options = { unicodeVersion };
  const supplied = { ...context, runtimeFunctions: createPythonSampleFunctions(options) };
  options.unicodeVersion = unicodeVersion === "15.0.0" ? "16.0.0" : "15.0.0";
  expect(calculate('=PY_CAPWORDS(UNICHAR(411))', supplied)).toEqual({ kind: "string", value: unicodeVersion === "15.0.0" ? "ƛ" : "Ƛ" });
  expect(calculate('=PY_CAPWORDS("HELLO\0WORLD")', supplied)).toEqual({ kind: "string", value: "Hello" });
  expect(calculate('=PY_CAPWORDS(NA())', supplied)).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate('=PY_BITAND(3,1)', supplied)).toEqual({ kind: "number", value: 1 });
  expect(() => calculate('=PY_CAPWORDS("hello")', { ...supplied, limits: { ...supplied.limits, outputBytes: 4 } })).toThrow("text limit");
  expect(() => calculate('=PY_CAPWORDS("hello")', { ...supplied, limits: { ...supplied.limits, workbookWork: 1 } })).toThrow("work limit");
});

it("rejects unknown Unicode profiles before creating a binding", () => {
  for (const unicodeVersion of ["17.0.0", "toString", ""]) {
    expect(() => createPythonSampleFunctions({ unicodeVersion: unicodeVersion as "15.0.0" })).toThrow("Unsupported Python Unicode version");
  }
});
