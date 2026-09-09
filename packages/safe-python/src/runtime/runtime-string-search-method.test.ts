import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(text = "a😀a😀") {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const str = v.string(text), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => { const method = runtimeNativeAttribute(str, name, v, meter); if (method.kind !== "builtin_function_or_method") throw new Error("expected method"); return method.value.invoke(args, keywords, meter); };
  return { v, keywords, call };
}

describe("native string search methods", () => {
  it.each([["find", 1], ["rfind", 3], ["index", 1], ["rindex", 3], ["count", 2]] as const)("implements %s using code-point positions", (name, expected) => {
    const { v, call } = fixture(); expect(call(name, [v.string("😀")])).toEqual(v.integer(expected));
  });
  it("accepts None bounds and saturates arbitrarily large bounds", () => {
    const { v, call } = fixture();
    expect(call("find", [v.string("a"), v.none, v.none])).toEqual(v.integer(0));
    expect(call("rfind", [v.string("a"), v.integer(-(1n << 100n)), v.integer(1n << 100n)])).toEqual(v.integer(2));
    expect(call("find", [v.string("a"), v.integer(-2)])).toEqual(v.integer(2));
  });
  it("does not match an empty needle when start is beyond the end", () => {
    const { v, call } = fixture();
    expect(call("count", [v.string(""), v.integer(4)])).toEqual(v.integer(1));
    expect(call("count", [v.string(""), v.integer(5)])).toEqual(v.integer(0));
    expect(call("find", [v.string(""), v.integer(5)])).toEqual(v.integer(-1));
    expect(() => call("index", [v.string(""), v.integer(5)])).toThrow("substring not found");
  });
  it("counts nonoverlapping matches and preserves lone surrogate positions", () => {
    const { v, call } = fixture("\ud800aaaa\udc00");
    expect(call("count", [v.string("aa")])).toEqual(v.integer(2));
    expect(call("rindex", [v.string("\udc00")])).toEqual(v.integer(5));
  });
  it("rejects invalid needles before bounds and validates call shape", () => {
    const { v, call, keywords } = fixture();
    expect(() => call("find", [v.none, v.float(1)])).toThrow(expect.objectContaining({ message: "find() argument 1 must be str, not None" }));
    expect(() => call("find", [v.string("a"), v.float(1)])).toThrow("slice indices must be integers or None or have an __index__ method");
    expect(() => call("count", [])).toThrow("count expected at least 1 argument, got 0");
    expect(() => call("count", [v.none, v.none, v.none, v.none])).toThrow("count expected at most 3 arguments, got 4");
    keywords.items.set(v.string("sub"), v.string("a"));
    expect(() => call("count", [])).toThrow("str.count() takes no keyword arguments");
  });
});
