import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(receiver, "is_integer", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, keywords, call };
}

it("returns canonical true for every int and bool without inspecting magnitude", () => {
  const { call, v } = fixture();
  for (const receiver of [v.true, v.false, v.integer(0n), v.integer(-1n), v.integer(1n << 100000n)]) {
    expect(call(receiver, [], new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toBe(v.true);
  }
});

it("accepts finite integral floats including signed zero and large exact values", () => {
  const { call, v } = fixture();
  for (const value of [0, -0, 1, -1, 2 ** 53, -(2 ** 100), Number.MAX_VALUE]) expect(call(v.float(value))).toBe(v.true);
  for (const value of [.5, -.5, 1.0000000000000002, Number.MIN_VALUE, -Number.MIN_VALUE, Infinity, -Infinity, NaN]) expect(call(v.float(value))).toBe(v.false);
});

it("rejects arguments using inherited int or float diagnostics", () => {
  const { call, v, keywords } = fixture();
  for (const receiver of [v.false, v.integer(0), v.float(NaN)]) expect(() => call(receiver, [v.none])).toThrow(`${receiver.kind === "float" ? "float" : "int"}.is_integer() takes no arguments (1 given)`);
  keywords.items.set(v.string("bad"), v.none);
  for (const receiver of [v.true, v.float(Infinity)]) expect(() => call(receiver)).toThrow(`${receiver.kind === "float" ? "float" : "int"}.is_integer() takes no keyword arguments`);
});

it("observes cancellation before returning a constant result", () => {
  const { call, v } = fixture(), controller = new AbortController();
  controller.abort();
  expect(() => call(v.true, [], new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
