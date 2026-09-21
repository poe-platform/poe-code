import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { pythonSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue } from "../workbook.js";

function calculate(value: CellValue, overrides: Partial<CapabilityContext> = {}, formula = "=PY_CAPWORDS(A1)") {
  const context: CapabilityContext = {
    signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 1000 },
    runtimeFunctions: pythonSampleFunctions, own() {}, ...overrides
  };
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value },
    { row: 0, column: 1, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context).sheets[0]!.cells[1]!.value;
}

it("independently distinguishes every ASCII whitespace from retained control characters", () => {
  const whitespace = new Set([9, 10, 11, 12, 13, 28, 29, 30, 31, 32]);
  for (let code = 0; code < 128; code++) {
    const character = String.fromCharCode(code);
    // Literal test expectations cover the ASCII partition, without Python/native execution.
    const middle = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
    expect(calculate({ kind: "string", value: `LEFT${character}RIGHT` }))
      .toEqual({ kind: "string", value: whitespace.has(code) ? "Left Right" : `Left${middle}right` });
  }
});

it("capitalizes the first character even when a word begins with punctuation or a digit", () => {
  for (const [value, expected] of [
    ["'HELLO \"WORLD 9LIVES _NAME .TITLE", "'hello \"world 9lives _name .title"],
    ["a.BC A/BC A\\BC A:BC A_BC A-Bc", "A.bc A/bc A\\bc A:bc A_bc A-bc"],
    ["\t\n\v\f\r\u001c\u001d\u001e\u001f ", ""],
    ["A\u0000B\u007fC", "A\u0000b\u007fc"]
  ]) expect(calculate({ kind: "string", value: value! })).toEqual({ kind: "string", value: expected });
});

it("keeps typed scalar values, error propagation, and arity distinct from missing namespace", () => {
  expect(calculate({ kind: "number", value: 123 })).toEqual({ kind: "string", value: "123" });
  expect(calculate({ kind: "boolean", value: true })).toEqual({ kind: "string", value: "True" });
  expect(calculate({ kind: "blank" })).toEqual({ kind: "string", value: "" });
  expect(calculate({ kind: "error", value: "#REF!" })).toEqual({ kind: "error", value: "#REF!" });
  expect(calculate({ kind: "blank" }, {}, "=PY_CAPWORDS(A1,A1)"))
    .toEqual({ kind: "error", value: "#N/A" });
  expect(calculate({ kind: "blank" }, { runtimeFunctions: {} }))
    .toEqual({ kind: "error", value: "#NAME?" });
});

it("accepts the output boundary, rejects one byte over, and charges normalized-away input work", () => {
  const limits = { inputBytes: 10000, outputBytes: 5, cells: 100, sheets: 10, operations: 1000 };
  expect(calculate({ kind: "string", value: "HELLO" }, { limits }))
    .toEqual({ kind: "string", value: "Hello" });
  expect(() => calculate({ kind: "string", value: "HELLO!" }, { limits })).toThrow("text limit");
  expect(() => calculate({ kind: "string", value: " ".repeat(1000) }, {
    limits: { ...limits, workbookWork: 100 }
  })).toThrow("work limit");
});

it("preserves caller cancellation reason and never hides unsupported Unicode in whitespace", () => {
  const controller = new AbortController(), reason = { cancelled: true };
  controller.abort(reason);
  try {
    calculate({ kind: "string", value: "HELLO" }, { signal: controller.signal });
    throw new Error("Expected cancellation");
  } catch (error) { expect(error).toBe(reason); }
  for (const value of ["\u0085", "\u00a0", "\u2003", "\u0130", "\u00df", "\ud800"])
    expect(() => calculate({ kind: "string", value })).toThrow("Unicode");
});
