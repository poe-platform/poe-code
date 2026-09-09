import { describe, expect, it } from "vitest";
import { lengthHint, type LengthHintContext } from "./length-hint.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const notImplemented = Symbol("NotImplemented");
const context: LengthHintContext<unknown> = {
  length: () => undefined, lookupHint: () => undefined,
  integer: value => typeof value === "bigint" ? value : typeof value === "boolean" ? value ? 1n : 0n : undefined,
  isNotImplemented: value => value === notImplemented,
  isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
  typeName: () => "float"
};

describe("length hint protocol", () => {
  it("returns a length before looking up a hint", () => {
    expect(lengthHint({}, { ...context, length: () => 3n, lookupHint: () => { throw new Error("unexpected hint"); } }, budget())).toBe(3n);
  });
  it("falls back after length TypeError, including invalid length conversion", () => {
    expect(lengthHint({}, { ...context, length: () => { throw new PythonRuntimeError("TypeError", "bad len"); }, lookupHint: () => () => 4n }, budget())).toBe(4n);
  });
  it.each(["ValueError", "OverflowError", "RuntimeError"])("propagates length %s without hint fallback", name => {
    const failure = new PythonRuntimeError(name, "length failed");
    expect(() => lengthHint({}, { ...context, length: () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("does not suppress TypeError from descriptor lookup", () => {
    const failure = new PythonRuntimeError("TypeError", "descriptor failed");
    expect(() => lengthHint({}, { ...context, lookupHint: () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("uses the default when the hint call raises TypeError", () => {
    expect(lengthHint({}, { ...context, lookupHint: () => () => { throw new PythonRuntimeError("TypeError", "call failed"); } }, budget(), 8n)).toBe(8n);
  });
  it("uses defaults for missing hints and NotImplemented", () => {
    expect(lengthHint({}, context, budget())).toBe(0n);
    expect(lengthHint({}, context, budget(), -3n)).toBe(-3n);
    expect(lengthHint({}, { ...context, lookupHint: () => () => notImplemented }, budget(), 8n)).toBe(8n);
  });
  it("accepts bool and integer hint results", () => {
    for (const value of [true, false, 7n]) {
      expect(lengthHint({}, { ...context, lookupHint: () => () => value }, budget())).toBe(value === true ? 1n : value === false ? 0n : value);
    }
  });
  it("rejects non-integers returned by the hint instead of falling back", () => {
    expect(() => lengthHint({}, { ...context, lookupHint: () => () => 1.5 }, budget(), 8n)).toThrow(expect.objectContaining({
      name: "TypeError", message: "__length_hint__ must be an integer, not float"
    }));
  });
  it.each([-1n, -(1n << 100n), 1n << 100n])("validates hint range %s", value => {
    expect(() => lengthHint({}, { ...context, lookupHint: () => () => value }, budget())).toThrow(expect.objectContaining({
      name: value === -1n ? "ValueError" : "OverflowError",
      message: value === -1n ? "__length_hint__() should return >= 0" : "Python int too large to convert to C ssize_t"
    }));
  });
  it("validates length bounds before returning or falling back", () => {
    expect(() => lengthHint({}, { ...context, length: () => -1n }, budget())).toThrow(expect.objectContaining({ name: "ValueError" }));
    expect(() => lengthHint({}, { ...context, length: () => 1n << 100n }, budget())).toThrow(expect.objectContaining({ name: "OverflowError" }));
  });
  it("preserves fatal execution limits instead of interpreting them as missing hints", () => {
    const failure = new ExecutionLimitError("steps");
    expect(() => lengthHint({}, { ...context, lookupHint: () => () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("checks the meter after a successful hint callback", () => {
    let reject = false;
    expect(() => lengthHint({}, { ...context, lookupHint: () => () => { reject = true; return 3n; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
