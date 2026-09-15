import { expect, it } from "vitest";
import { createAbsBuiltin, type AbsHooks } from "./builtin-abs.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(hooks: AbsHooks = {}) {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createAbsBuiltin(v, meter, hooks);
  return { v, meter, keywords, builtin, call: (value: RuntimeValue) => builtin.value.invoke([value], keywords, meter) };
}
it("preserves nonnegative integer identity and returns exact positive integers", () => {
  const { v, call } = fixture();
  for (const number of [0n, 1n, 1000n, (1n << 20000n) + 17n]) {
    const positive = v.integer(number);
    expect(call(positive)).toBe(positive);
    expect(call(v.integer(-number))).toEqual(positive);
  }
  expect(call(v.true)).toEqual(v.integer(1));
  expect(call(v.false)).toEqual(v.integer(0));
  for (const number of [0, 1, 255, 256]) expect(call(v.integer(-number))).toBe(v.integer(number));
  expect(call(v.integer(-257))).not.toBe(call(v.integer(-257)));
});
it("handles float signs and complex magnitude without coercion", () => {
  const { v, call } = fixture();
  for (const number of [-0, 0, -1.25, Infinity, -Infinity, NaN]) expect(call(v.float(number))).toEqual(v.float(Math.abs(number)));
  expect(call(v.complex(-3, 4))).toEqual(v.float(5));
  expect(call(v.complex(Infinity, NaN))).toEqual(v.float(Infinity));
  expect(() => call(v.complex(1.7e308, 1.7e308))).toThrow("absolute value too large");
});
it("validates public arguments before special-method lookup", () => {
  let lookups = 0;
  const { v, call, builtin, keywords, meter } = fixture({ lookupAbs() { lookups++; return undefined; } });
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("abs() takes exactly one argument (0 given)");
  expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow("abs() takes exactly one argument (2 given)");
  keywords.items.set(v.string("x"), v.none);
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("abs() takes no keyword arguments");
  expect(lookups).toBe(0);
  keywords.items.clear();
  expect(() => call(v.none)).toThrow("bad operand type for abs(): 'NoneType'");
  expect(() => call(v.notImplemented)).toThrow("bad operand type for abs(): 'NotImplementedType'");
});
it("returns arbitrary guest slot results unchanged and propagates slot failures", () => {
  let result: RuntimeValue, shouldFail = false, lookups = 0;
  const failure = Error("guest failure");
  const { v, call } = fixture({ lookupAbs() { lookups++; return () => { if (shouldFail) throw failure; return result; }; } });
  const guest = v.cell({});
  for (const value of [v.none, v.notImplemented, v.string("result"), v.true, guest]) {
    result = value; expect(call(guest)).toBe(value);
  }
  expect(lookups).toBe(5);
  call(v.integer(-1)); expect(lookups).toBe(5);
  shouldFail = true; expect(() => call(guest)).toThrow(failure);
});
it("observes cancellation after guest lookup and invocation", () => {
  for (const stage of ["lookup", "invoke"]) {
    const controller = new AbortController();
    const { v, builtin, keywords } = fixture({ lookupAbs() {
      if (stage === "lookup") controller.abort();
      return () => { controller.abort(); return v.none; };
    } });
    const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal });
    expect(() => builtin.value.invoke([v.cell({})], keywords, meter)).toThrow(ExecutionLimitError);
  }
});
