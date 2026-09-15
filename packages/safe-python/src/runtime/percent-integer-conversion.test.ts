import { expect, it } from "vitest";
import { percentInteger, type PercentIntegerContext } from "./percent-integer-conversion.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Value { name: string; integer?: bigint; exact?: boolean; float?: number; int?: () => Value; index?: () => Value }
const integer = (value: bigint): Value => ({ name: "int", integer: value, exact: true });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
function fixture() {
  const warnings: string[] = [];
  const context: PercentIntegerContext<Value> = {
    integer: value => value.integer, isExactInteger: value => value.exact === true,
    float: value => value.float, lookupInt: value => value.int, lookupIndex: value => value.index,
    typeName: value => value.name, warn: (_category, message) => { warnings.push(message); }
  };
  return { context, warnings };
}
it("bypasses conversion overrides for integer and bool payloads", () => {
  const { context, warnings } = fixture();
  const value: Value = { name: "Sub", integer: 7n, int: () => { throw Error("must not call"); }, index: () => { throw Error("must not call"); } };
  for (const code of [100, 105, 117, 111, 120, 88]) expect(percentInteger(value, code, context, budget())).toBe(7n);
  expect(warnings).toEqual([]);
});
it("truncates only exact float operands for decimal conversions", () => {
  const { context } = fixture();
  for (const code of [100, 105, 117]) {
    expect(percentInteger({ name: "float", float: -1.9 }, code, context, budget())).toBe(-1n);
    expect(percentInteger({ name: "float", float: -0 }, code, context, budget())).toBe(0n);
    expect(() => percentInteger({ name: "float", float: NaN }, code, context, budget())).toThrow("cannot convert float NaN to integer");
    expect(() => percentInteger({ name: "float", float: Infinity }, code, context, budget())).toThrow("cannot convert float infinity to integer");
  }
  expect(() => percentInteger({ name: "float", float: 1.9 }, 120, context, budget())).toThrow("%x format: an integer is required, not float");
});
it("prefers __int__ for decimal but uses only __index__ for octal/hex", () => {
  const { context } = fixture(), calls: string[] = [];
  const value = { name: "Both", int: () => { calls.push("int"); return integer(8n); }, index: () => { calls.push("index"); return integer(9n); } };
  expect(percentInteger(value, 100, context, budget())).toBe(8n);
  expect(percentInteger(value, 111, context, budget())).toBe(9n);
  expect(percentInteger({ name: "Index", index: value.index }, 100, context, budget())).toBe(9n);
  expect(calls).toEqual(["int", "index", "index"]);
});
it("does not fall back after an invalid __int__ result and rewrites TypeError", () => {
  const { context } = fixture();
  const value = { name: "Bad", int: () => ({ name: "str" }), index: () => { throw Error("must not fall back"); } };
  expect(() => percentInteger(value, 117, context, budget())).toThrow("%u format: a real number is required, not Bad");
  expect(() => percentInteger({ name: "Bad", index: () => { throw new PythonRuntimeError("TypeError", "custom"); } }, 88, context, budget())).toThrow("%X format: an integer is required, not Bad");
});
it("preserves non-TypeError exceptions by identity", () => {
  const { context } = fixture(), error = new PythonRuntimeError("ValueError", "custom");
  expect(() => percentInteger({ name: "C", int: () => { throw error; } }, 100, context, budget())).toThrow(error);
});
it("warns for strict subclass method results through either conversion slot", () => {
  const { context, warnings } = fixture(), result = { name: "bool", integer: 1n };
  expect(percentInteger({ name: "C", int: () => result }, 100, context, budget())).toBe(1n);
  expect(percentInteger({ name: "C", index: () => result }, 120, context, budget())).toBe(1n);
  expect(warnings[0]).toContain("__int__ returned non-int (type bool).");
  expect(warnings[1]).toContain("__index__ returned non-int (type bool).");
});
it("supports guest TypeError classification without reclassifying fatal limits", () => {
  const { context } = fixture(), guest = {}, fatal = new ExecutionLimitError("cancelled");
  context.isTypeError = error => error === guest || error === fatal;
  expect(() => percentInteger({ name: "C", int: () => { throw guest; } }, 100, context, budget())).toThrow("%d format: a real number is required, not C");
  expect(() => percentInteger({ name: "C", int: () => { throw fatal; } }, 100, context, budget())).toThrow(fatal);
});
it("limits type diagnostics to complete UTF-8 characters within 200 bytes", () => {
  const { context } = fixture();
  expect(() => percentInteger({ name: "€".repeat(100) }, 100, context, budget())).toThrow(new PythonRuntimeError("TypeError", "%d format: a real number is required, not " + "€".repeat(66)));
});
it("checks cancellation after callbacks and validates conversion codes", () => {
  const { context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  expect(() => percentInteger({ name: "C", int: () => { cancelled = true; return integer(1n); } }, 100, context, meter)).toThrow(ExecutionLimitError);
  expect(() => percentInteger(integer(1n), 115, context, budget())).toThrow(RangeError);
});
