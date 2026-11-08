import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { pythonSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 }, runtimeFunctions: pythonSampleFunctions, own() {} };
const cases: readonly (readonly [string, CellValue, string])[] = [
  ["true", { kind: "boolean", value: true }, "bool"],
  ["false", { kind: "boolean", value: false }, "bool"],
  ["blank", { kind: "blank" }, "NoneType"],
  ["integer", { kind: "number", value: 123 }, "float"],
  ["decimal", { kind: "number", value: 1.2345678901234567 }, "float"],
  ["tiny", { kind: "number", value: 1e-20 }, "float"],
  ["large", { kind: "number", value: 1e20 }, "float"]
];
it.each(cases)("matches the activated Python loader for %s", (_name, value, type) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value }, { row: 0, column: 1, formula: "=PY_CAPWORDS(A1)", formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context);
  expect(result.sheets[0]?.cells[1]?.value).toEqual({ kind: "error", value: `Python exception (<class 'AttributeError'>: '${type}' object has no attribute 'split')` });
});

it.each([
  ["hELLO\0wORLD", "Hello"], ["\0wORLD", ""], ["A\0\ud800", "A"]
])("clips Python C-string input %s at the native NUL boundary", (value, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: { kind: "string", value: value! } },
    { row: 0, column: 1, formula: "=PY_CAPWORDS(A1)", formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context);
  expect(result.sheets[0]?.cells[1]?.value).toEqual({ kind: "string", value: expected });
});

it.each(["\ud800", "a\udc00"])("refuses malformed visible host UTF-16 %s before Python capitalization", value => {
  expect(() => recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: { kind: "string", value } },
    { row: 0, column: 1, formula: "=PY_CAPWORDS(A1)", formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context)).toThrow("Malformed host UTF-16");
});
