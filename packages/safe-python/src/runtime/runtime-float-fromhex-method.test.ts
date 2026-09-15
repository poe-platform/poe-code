import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(v.float(99), "fromhex", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, keywords, call };
}
it("ignores the instance value and creates fresh decoded floats", () => {
  const { call, v } = fixture(), source = v.string("-0x1.8p1");
  expect(call([source])).toEqual(v.float(-3)); expect(call([source])).not.toBe(call([source]));
});
it("requires exactly one positional string argument", () => {
  const { call, v, keywords } = fixture();
  expect(() => call([])).toThrow("float.fromhex() takes exactly one argument (0 given)");
  expect(() => call([v.none, v.none])).toThrow("float.fromhex() takes exactly one argument (2 given)");
  for (const value of [v.none, v.integer(1), v.bytes(new Uint8Array())]) expect(() => call([value])).toThrow("bad argument type for built-in operation");
  keywords.items.set(v.string("string"), v.string("1"));
  expect(() => call([])).toThrow("float.fromhex() takes no keyword arguments");
});
