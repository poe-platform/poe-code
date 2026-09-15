import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const kw = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const tuple = v.tuple([v.true, v.integer(2), v.integer(1)]);
  const call = (name: string, args: RuntimeValue[], receiver = tuple) => {
    const method = runtimeNativeAttribute(receiver, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, kw, meter);
  };
  return { v, tuple, kw, call };
}

describe("native tuple search methods", () => {
  it("counts equal bool/int values and returns the first matching index", () => {
    const { v, call } = fixture();
    expect(call("count", [v.integer(1)])).toEqual(v.integer(2));
    expect(call("index", [v.integer(1)])).toEqual(v.integer(0));
    expect(call("count", [v.integer(9)])).toEqual(v.integer(0));
  });
  it.each([[1, 3, 2], [-2, 3, 2], [0, -1, 0]] as const)("searches within %s:%s", (start, stop, expected) => {
    const { v, call } = fixture(); expect(call("index", [v.true, v.integer(start), v.integer(stop)])).toEqual(v.integer(expected));
  });
  it("clips huge bounds and rejects None rather than treating it as omitted", () => {
    const { v, call } = fixture();
    expect(call("index", [v.true, v.integer(-(1n << 100n)), v.integer(1n << 100n)])).toEqual(v.integer(0));
    expect(() => call("index", [v.true, v.none])).toThrow("slice indices must be integers or have an __index__ method");
    expect(() => call("index", [v.true, v.integer(3)])).toThrow("tuple.index(x): x not in tuple");
  });
  it("preserves identity shortcuts for NaN and structural comparison for lists", () => {
    const { v, call } = fixture(), nan = v.float(NaN), tuple = v.tuple([nan, v.list([v.true]), nan]);
    expect(call("count", [nan], tuple)).toEqual(v.integer(2));
    expect(call("index", [v.list([v.integer(1)])], tuple)).toEqual(v.integer(1));
  });
  it("validates call arguments before searching", () => {
    const { v, call, kw } = fixture();
    expect(() => call("count", [])).toThrow("tuple.count() takes exactly one argument (0 given)");
    expect(() => call("index", [])).toThrow("index expected at least 1 argument, got 0");
    expect(() => call("index", [v.true, v.none, v.none, v.none])).toThrow("index expected at most 3 arguments, got 4");
    kw.items.set(v.string("x"), v.true);
    expect(() => call("count", [v.true])).toThrow("tuple.count() takes no keyword arguments");
  });
});
