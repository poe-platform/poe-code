import { expect, it } from "vitest";
import { percentFloat, type PercentFloatContext } from "./percent-float-conversion.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Value { name: string; floating?: number; integer?: bigint; exact?: boolean; float?: () => Value; index?: () => Value }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
function fixture() {
  const warnings: string[] = [];
  const context: PercentFloatContext<Value> = {
    float: value => value.floating, isExactFloat: value => value.exact === true,
    integer: value => value.integer, isExactInteger: value => value.exact === true,
    lookupFloat: value => value.float, lookupIndex: value => value.index,
    typeName: value => value.name, warn: (_category, message) => { warnings.push(message); }
  };
  return { context, warnings };
}
it("uses float subclass payloads without calling overrides", () => {
  const { context } = fixture();
  for (const floating of [-0, 1.5, NaN, Infinity, -Infinity]) expect(percentFloat({ name: "F", floating, float: () => { throw Error("override"); } }, false, context, budget())).toBe(floating);
});
it("honors integer float overrides before integer payload fallback", () => {
  const { context } = fixture();
  expect(percentFloat({ name: "I", integer: 2n, float: () => ({ name: "float", floating: 7.5, exact: true }) }, false, context, budget())).toBe(7.5);
  expect(percentFloat({ name: "bool", integer: 1n }, false, context, budget())).toBe(1);
  expect(percentFloat({ name: "X", index: () => ({ name: "int", integer: 3n, exact: true }) }, false, context, budget())).toBe(3);
});
it("rejects non-float results without index fallback", () => {
  const { context } = fixture();
  const value = { name: "C", float: () => ({ name: "int", integer: 1n }), index: () => { throw Error("fallback"); } };
  expect(() => percentFloat(value, false, context, budget())).toThrow("C.__float__ returned non-float (type int)");
  expect(() => percentFloat({ name: "str" }, false, context, budget())).toThrow("must be real number, not str");
});
it("warns for float and index subclass results", () => {
  const { context, warnings } = fixture();
  expect(percentFloat({ name: "C", float: () => ({ name: "F", floating: 2 }) }, false, context, budget())).toBe(2);
  expect(percentFloat({ name: "C", index: () => ({ name: "bool", integer: 1n }) }, false, context, budget())).toBe(1);
  expect(warnings).toEqual([
    "C.__float__ returned non-float (type F).  The ability to return an instance of a strict subclass of float is deprecated, and may be removed in a future version of Python.",
    "__index__ returned non-int (type bool).  The ability to return an instance of a strict subclass of int is deprecated, and may be removed in a future version of Python."
  ]);
});
it("preserves text exceptions and remaps guest bytes exceptions", () => {
  const { context } = fixture();
  for (const name of ["TypeError", "ValueError", "OverflowError"] as const) {
    const error = new PythonRuntimeError(name, "custom"), value = { name: "C", float: () => { throw error; } };
    expect(() => percentFloat(value, false, context, budget())).toThrow(error);
    expect(() => percentFloat(value, true, context, budget())).toThrow("float argument required, not C");
  }
  expect(() => percentFloat({ name: "int", integer: 1n << 2000n }, false, context, budget())).toThrow("int too large to convert to float");
  expect(() => percentFloat({ name: "int", integer: 1n << 2000n }, true, context, budget())).toThrow("float argument required, not int");
});
it("supports guest exception classification without swallowing host or fatal errors", () => {
  const { context } = fixture(), guest = {}, fatal = new ExecutionLimitError("cancelled"), host = new Error("host");
  context.isPythonException = error => error === guest || error === fatal;
  expect(() => percentFloat({ name: "C", float: () => { throw guest; } }, true, context, budget())).toThrow("float argument required, not C");
  for (const error of [fatal, host]) expect(() => percentFloat({ name: "C", float: () => { throw error; } }, true, context, budget())).toThrow(error);
});
it("checks cancellation after a conversion callback", () => {
  const { context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  expect(() => percentFloat({ name: "C", float: () => { cancelled = true; return { name: "float", floating: 1, exact: true }; } }, true, context, meter)).toThrow(ExecutionLimitError);
});
it("uses 50-byte float protocol names and 200-byte bytes-format names", () => {
  const { context } = fixture(), value = { name: "€".repeat(100) };
  expect(() => percentFloat(value, false, context, budget())).toThrow("must be real number, not " + "€".repeat(16));
  expect(() => percentFloat(value, true, context, budget())).toThrow("float argument required, not " + "€".repeat(66));
  expect(() => percentFloat({ ...value, float: () => ({ name: "X".repeat(100) }) }, false, context, budget())).toThrow("€".repeat(16) + ".__float__ returned non-float (type " + "X".repeat(50) + ")");
});
