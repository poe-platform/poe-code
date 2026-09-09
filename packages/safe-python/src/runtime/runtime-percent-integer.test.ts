import { expect, it } from "vitest";
import { createRuntimePercentIntegerContext } from "./runtime-percent-integer.js";
import { percentInteger } from "./percent-integer-conversion.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { v, meter, context: createRuntimePercentIntegerContext(meter) };
}
it("extracts exact native integer, bool and float values", () => {
  const { v, meter, context } = fixture();
  expect(percentInteger(v.integer(-(1n << 100n)), 120, context, meter)).toBe(-(1n << 100n));
  expect(percentInteger(v.true, 111, context, meter)).toBe(1n);
  expect(percentInteger(v.false, 100, context, meter)).toBe(0n);
  expect(percentInteger(v.float(-1.9), 105, context, meter)).toBe(-1n);
  expect(() => percentInteger(v.float(1.9), 88, context, meter)).toThrow("%X format: an integer is required, not float");
});
it("rejects native nonnumeric inputs without parsing strings or bytes", () => {
  const { v, meter, context } = fixture();
  for (const [source, name] of [[v.string("123"), "str"], [v.bytes(Uint8Array.of(49)), "bytes"], [v.list([]), "list"], [v.none, "NoneType"], [v.notImplemented, "NotImplementedType"]] as const) {
    expect(() => percentInteger(source, 100, context, meter)).toThrow(`%d format: a real number is required, not ${name}`);
  }
});
it("uses explicit guest slots with hook ownership and subclass payload inspection", () => {
  const { v, meter } = fixture(), source = v.cell({}), subclass = v.cell({}), calls: string[] = [];
  const hooks = {
    integer: (value: unknown) => value === subclass ? 7n : undefined,
    lookupInt(value: unknown) { expect(this).toBe(hooks); return value === source ? () => { calls.push("int"); return subclass; } : undefined; },
    lookupIndex(value: unknown) { expect(this).toBe(hooks); return value === source ? () => { calls.push("index"); return v.integer(8); } : undefined; },
    typeName: (value: unknown) => value === subclass ? "Sub" : "C",
    warn(_category: string, message: string) { expect(this).toBe(hooks); calls.push(message); }
  };
  const context = createRuntimePercentIntegerContext(meter, hooks);
  expect(percentInteger(source, 100, context, meter)).toBe(7n);
  expect(percentInteger(source, 120, context, meter)).toBe(8n);
  expect(percentInteger(subclass, 100, context, meter)).toBe(7n);
  expect(calls[0]).toBe("int"); expect(calls[1]).toContain("__int__ returned non-int (type Sub)"); expect(calls[2]).toBe("index");
  expect(calls).toHaveLength(3);
});
it("routes returned bool warnings through the caller's warning policy", () => {
  const { v, meter } = fixture(), source = v.cell({}), failure = new Error("warning filter");
  const context = createRuntimePercentIntegerContext(meter, { lookupInt: () => () => v.true, warn: (_category, message) => { expect(message).toContain("type bool"); throw failure; } });
  expect(() => percentInteger(source, 100, context, meter)).toThrow(failure);
});
it("classifies guest TypeError and preserves other guest failures", () => {
  const { v, meter } = fixture(), source = v.cell({}), failure = {}, valueError = new PythonRuntimeError("ValueError", "custom");
  let raised: unknown = failure;
  const context = createRuntimePercentIntegerContext(meter, { lookupIndex: () => () => { throw raised; }, isTypeError: error => error === failure, typeName: () => "Guest", warn: () => {} });
  expect(() => percentInteger(source, 120, context, meter)).toThrow("%x format: an integer is required, not Guest");
  raised = valueError;
  expect(() => percentInteger(source, 120, context, meter)).toThrow(valueError);
});
it("checks cancellation after guest lookup and never suppresses fatal errors", () => {
  const { v } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const context = createRuntimePercentIntegerContext(meter, { lookupInt: () => { cancelled = true; return () => v.true; }, isTypeError: () => true, warn: () => {} });
  expect(() => percentInteger(v.cell({}), 100, context, meter)).toThrow(ExecutionLimitError);
});
