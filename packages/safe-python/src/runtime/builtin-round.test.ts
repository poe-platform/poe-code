import { expect, it } from "vitest";
import { createRoundBuiltin, type RoundContext } from "./builtin-round.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(context: RoundContext = {}) {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createRoundBuiltin(v, meter, context);
  return { v, meter, keywords, builtin, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}
it("rounds native numbers with ties to even and preserves only integer identity", () => {
  const { v, call } = fixture(), integer = v.integer(1000);
  expect(call(integer)).toBe(integer);
  expect(call(integer, v.integer(5))).toBe(integer);
  expect(call(v.true)).toBe(v.integer(1));
  expect(call(v.integer(125), v.integer(-1))).toBe(v.integer(120));
  expect(call(v.float(2.5))).toBe(v.integer(2));
  expect(call(v.float(2.675), v.integer(2))).toEqual(v.float(2.67));
  expect(call(v.float(-0.5), v.integer(0))).toEqual(v.float(-0));
  const floating = v.float(1.5);
  expect(call(floating, v.integer(1000))).toEqual(floating);
  expect(call(floating, v.integer(1000))).not.toBe(floating);
});
it("binds named arguments and reports validation errors before rounding", () => {
  const { v, call, keywords } = fixture();
  expect(() => call()).toThrow("round() missing required argument 'number' (pos 1)");
  expect(() => call(v.none, v.none, v.none)).toThrow("round() takes at most 2 arguments (3 given)");
  keywords.items.set(v.string("number"), v.float(1.5));
  expect(call()).toBe(v.integer(2));
  expect(() => call(v.none)).toThrow("argument for round() given by name ('number') and position (1)");
  keywords.items.clear(); keywords.items.set(v.string("x"), v.none);
  expect(() => call()).toThrow("round() missing required argument 'number' (pos 1)");
  expect(() => call(v.none)).toThrow("round() got an unexpected keyword argument 'x'");
});
it("forwards unconverted guest digits and unrestricted results, omitting None", () => {
  const seen: (RuntimeValue | undefined)[] = [];
  const { v, call } = fixture({ lookupRound() { return digits => { seen.push(digits); return v.notImplemented; }; } });
  const guest = v.cell({}), digits = v.cell({});
  expect(call(guest)).toBe(v.notImplemented);
  expect(call(guest, v.none)).toBe(v.notImplemented);
  expect(call(guest, digits)).toBe(v.notImplemented);
  expect(seen).toEqual([undefined, undefined, digits]);
});
it("validates native digits before handling nonfinite floats and missing round slots", () => {
  const { v, call } = fixture();
  expect(() => call(v.float(Infinity), v.float(1))).toThrow("'float' object cannot be interpreted as an integer");
  expect(() => call(v.float(Infinity))).toThrow("cannot convert float infinity to integer");
  expect(call(v.float(Infinity), v.integer(0))).toEqual(v.float(Infinity));
  expect(() => call(v.none, v.float(1))).toThrow("type NoneType doesn't define __round__ method");
});
it("uses the index protocol for native ndigits without narrowing huge values", () => {
  let conversions = 0;
  const { v, call } = fixture({ index: {
    integer: value => value.kind === "int" ? value.value : undefined,
    isExactInteger: value => value.kind === "int", typeName: () => "Guest",
    warn() { throw new Error("unexpected warning"); },
    lookupIndex() { conversions++; return () => v.integer(-(10n ** 100n)); }
  } });
  expect(call(v.float(-1.25), v.cell({}))).toEqual(v.float(-0));
  expect(call(v.integer(123), v.cell({}))).toBe(v.integer(0));
  expect(conversions).toBe(2);
});
it("observes cancellation after guest lookup and invocation", () => {
  for (const phase of ["lookup", "invoke"]) {
    const controller = new AbortController();
    const { v, builtin, keywords } = fixture({ lookupRound() {
      if (phase === "lookup") controller.abort();
      return () => { controller.abort(); return v.none; };
    } });
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
    expect(() => builtin.value.invoke([v.cell({})], keywords, meter)).toThrow(ExecutionLimitError);
  }
});
