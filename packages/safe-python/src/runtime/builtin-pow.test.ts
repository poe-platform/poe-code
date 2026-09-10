import { expect, it } from "vitest";
import { createPowBuiltin, type PowContext } from "./builtin-pow.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(context: PowContext = {}) {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createPowBuiltin(v, meter, context);
  return { v, meter, keywords, builtin, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}
it("executes integer, float, complex and modular powers", () => {
  const { v, call } = fixture();
  expect(call(v.integer(2), v.integer(100))).toEqual(v.integer(1n << 100n));
  expect(call(v.float(4), v.float(0.5), v.none)).toEqual(v.float(2));
  expect(call(v.complex(0, 1), v.integer(2))).toEqual(v.complex(-1, 0));
  expect(call(v.integer(38), v.integer(-1), v.integer(97))).toEqual(v.integer(23));
  expect(call(v.integer(2), v.integer(3), v.integer(-5))).toEqual(v.integer(-2));
});
it("binds keyword arguments and prioritizes missing arguments before duplicates", () => {
  const { v, call, keywords } = fixture();
  expect(() => call()).toThrow("pow() missing required argument 'base' (pos 1)");
  keywords.items.set(v.string("base"), v.integer(2));
  expect(() => call(v.integer(3))).toThrow("pow() missing required argument 'exp' (pos 2)");
  keywords.items.set(v.string("exp"), v.integer(3));
  expect(call()).toEqual(v.integer(8));
  expect(() => call(v.integer(3))).toThrow("argument for pow() given by name ('base') and position (1)");
  keywords.items.set(v.string("mod"), v.integer(5));
  expect(call()).toEqual(v.integer(3));
  expect(() => call(v.none)).toThrow("pow() takes at most 3 arguments (4 given)");
});
it("preserves native ternary slot order and conversion errors", () => {
  const { v, call } = fixture();
  expect(() => call(v.none, v.integer(3), v.float(2))).toThrow("pow() 3rd argument not allowed unless all arguments are integers");
  expect(() => call(v.integer(2), v.complex(3, 0), v.float(2))).toThrow("complex modulo");
  expect(() => call(v.integer(2), v.float(3), v.complex(2, 0))).toThrow("pow() 3rd argument not allowed unless all arguments are integers");
  expect(() => call(v.integer(1n << 2000n), v.none, v.complex(2, 0))).toThrow("int too large to convert to float");
  expect(() => call(v.none, v.integer(3), v.complex(2, 0))).toThrow("unsupported operand type(s) for ** or pow(): 'NoneType', 'int', 'complex'");
});
it("forwards guest operands unchanged and normalizes absent modulus to None", () => {
  const received: RuntimeValue[][] = [];
  const { v, call } = fixture({ power(...args) { received.push(args); return v.none; } });
  const base = v.cell({}), exponent = v.cell({}), modulus = v.cell({});
  expect(call(base, exponent)).toBe(v.none);
  expect(call(base, exponent, modulus)).toBe(v.none);
  expect(received).toEqual([[base, exponent, v.none], [base, exponent, modulus]]);
});
it("reports declines and checks cancellation after guest dispatch", () => {
  const controller = new AbortController();
  let cancel = false;
  const { v, call, builtin, keywords } = fixture({ power() { if (cancel) controller.abort(); return v.notImplemented; }, typeName: () => "Guest" });
  expect(() => call(v.cell({}), v.cell({}))).toThrow("unsupported operand type(s) for ** or pow(): 'Guest' and 'Guest'");
  cancel = true;
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow(ExecutionLimitError);
});
it.each([false, true])("retains power diagnostics and cancellation with explicit policy=%s", explicit => {
  const { v, meter, keywords } = fixture(), guest = v.cell({}), unused = (): never => { throw Error("explicit policy must win"); }; let cancelled = false;
  const policy: PowContext = { power() { expect(this).toBe(policy); return v.notImplemented; }, typeName: () => "Guest" };
  const builtin = createPowBuiltin(v, meter, explicit ? policy : undefined);
  const invocation = { call: unused, isStopIteration: unused, power: explicit ? { power: unused } : policy };
  expect(() => builtin.value.invoke([guest, guest], keywords, meter, invocation)).toThrow("unsupported operand type(s) for ** or pow(): 'Guest' and 'Guest'");
  policy.power = () => { cancelled = true; return v.none; };
  expect(() => builtin.value.invoke([guest, guest], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, invocation)).toThrow(ExecutionLimitError);
});
