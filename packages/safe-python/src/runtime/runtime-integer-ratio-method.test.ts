import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(receiver, "as_integer_ratio", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, keywords, call };
}
function ratio(value: RuntimeValue) {
  if (value.kind !== "tuple") throw new Error("expected tuple");
  return value.items.map(item => {
    if (item.kind !== "int") throw new Error("expected integer");
    return item.value;
  });
}

it("retains exact integer numerators and converts boolean numerators to ints", () => {
  const { call, v } = fixture();
  for (const n of [0n, -1n, 1n << 10000n, -(1n << 10000n)]) {
    const receiver = v.integer(n), result = call(receiver);
    expect(ratio(result)).toEqual([n, 1n]);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result.items[0]).toBe(receiver);
  }
  expect(ratio(call(v.true))).toEqual([1n, 1n]);
  expect(ratio(call(v.false))).toEqual([0n, 1n]);
});

it("returns reduced exact binary64 ratios rather than decimal approximations", () => {
  const { call, v } = fixture();
  for (const [value, numerator, denominator] of [[.1, 3602879701896397n, 36028797018963968n], [-.75, -3n, 4n], [1.5, 3n, 2n], [0, 0n, 1n], [-0, 0n, 1n], [Number.MIN_VALUE, 1n, 1n << 1074n], [Number.MAX_VALUE, ((1n << 53n) - 1n) << 971n, 1n]] as const) expect(ratio(call(v.float(value)))).toEqual([numerator, denominator]);
});

it("raises Python non-finite errors after validating the call shape", () => {
  const { call, v } = fixture();
  expect(() => call(v.float(NaN))).toThrow("cannot convert NaN to integer ratio");
  for (const value of [Infinity, -Infinity]) expect(() => call(v.float(value))).toThrow("cannot convert Infinity to integer ratio");
  expect(() => call(v.float(NaN), [v.none])).toThrow("float.as_integer_ratio() takes no arguments (1 given)");
});

it("rejects arguments with the inherited int or float method name", () => {
  const { call, v, keywords } = fixture();
  for (const receiver of [v.true, v.integer(0n), v.float(0)]) expect(() => call(receiver, [v.none])).toThrow(`${receiver.kind === "float" ? "float" : "int"}.as_integer_ratio() takes no arguments (1 given)`);
  keywords.items.set(v.string("bad"), v.none);
  for (const receiver of [v.false, v.float(0)]) expect(() => call(receiver)).toThrow(`${receiver.kind === "float" ? "float" : "int"}.as_integer_ratio() takes no keyword arguments`);
});

it("checks cooperative work while reducing powers of two", () => {
  const { call, v } = fixture();
  expect(() => call(v.float(1), [], new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});
