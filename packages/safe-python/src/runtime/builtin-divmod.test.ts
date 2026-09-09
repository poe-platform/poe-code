import { expect, it } from "vitest";
import { createDivmodBuiltin, type DivmodContext } from "./builtin-divmod.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(context: DivmodContext = {}) {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createDivmodBuiltin(v, meter, context);
  return { v, meter, keywords, builtin, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}

it("returns floor quotients and divisor-signed remainders for exact real pairs", () => {
  const { v, call } = fixture();
  expect(call(v.integer(-7), v.integer(3))).toEqual(v.tuple([v.integer(-3), v.integer(2)]));
  expect(call(v.integer(7), v.integer(-3))).toEqual(v.tuple([v.integer(-3), v.integer(-2)]));
  expect(call(v.true, v.true)).toEqual(v.tuple([v.integer(1), v.integer(0)]));
  expect(call(v.integer(1), v.float(0.1))).toEqual(v.tuple([v.float(9), v.float(0.09999999999999995)]));
  expect(call(v.float(0), v.float(-2))).toEqual(v.tuple([v.float(-0), v.float(-0)]));
  const large = 1n << 10000n;
  expect(call(v.integer(large), v.integer(2))).toEqual(v.tuple([v.integer(large / 2n), v.integer(0)]));
});
it("validates arguments and preserves conversion-before-zero errors", () => {
  const { v, call, keywords } = fixture();
  expect(() => call()).toThrow("divmod expected 2 arguments, got 0");
  expect(() => call(v.none)).toThrow("divmod expected 2 arguments, got 1");
  expect(() => call(v.none, v.none, v.none)).toThrow("divmod expected 2 arguments, got 3");
  expect(() => call(v.integer(1), v.false)).toThrow("division by zero");
  expect(() => call(v.integer(1n << 10000n), v.float(0))).toThrow("int too large to convert to float");
  expect(() => call(v.none, v.integer(2))).toThrow("unsupported operand type(s) for divmod(): 'NoneType' and 'int'");
  keywords.items.set(v.string("a"), v.none);
  expect(() => call()).toThrow("divmod() takes no keyword arguments");
});
it("negotiates reflected subtype priority and preserves arbitrary guest results", () => {
  const trace: string[] = [];
  const { v, call } = fixture({ numeric() { return {
    relation: "right-subtype", notImplemented: v.notImplemented,
    reflectedIsOverridden() { trace.push("override"); return true; },
    reflected() { trace.push("reflected"); return v.none; },
    forward() { trace.push("forward"); return v.true; }
  }; } });
  expect(call(v.cell({}), v.cell({}))).toBe(v.none);
  expect(trace).toEqual(["override", "reflected"]);
});
it("reports both guest type names only after numeric slots decline", () => {
  const trace: string[] = [];
  const { v, call } = fixture({ typeName: () => "Guest", numeric() { return {
    relation: "other", notImplemented: v.notImplemented,
    reflectedIsOverridden: () => false,
    forward() { trace.push("forward"); return v.notImplemented; },
    reflected() { trace.push("reflected"); return v.notImplemented; }
  }; } });
  expect(() => call(v.cell({}), v.none)).toThrow("unsupported operand type(s) for divmod(): 'Guest' and 'Guest'");
  expect(trace).toEqual(["forward", "reflected"]);
});
it("checks cancellation after protocol preparation and successful dispatch", () => {
  for (const phase of ["prepare", "invoke"]) {
    const controller = new AbortController();
    const { v, builtin, keywords } = fixture({ numeric() {
      if (phase === "prepare") controller.abort();
      return { relation: "same", notImplemented: v.notImplemented, reflectedIsOverridden: () => false,
        reflected: () => v.notImplemented, forward() { controller.abort(); return v.none; } };
    } });
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
    expect(() => builtin.value.invoke([v.cell({}), v.cell({})], keywords, meter)).toThrow(ExecutionLimitError);
  }
});
