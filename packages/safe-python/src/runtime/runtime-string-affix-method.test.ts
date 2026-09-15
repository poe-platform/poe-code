import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string("a😀b\ud800");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => { const method = runtimeNativeAttribute(text, name, v, meter); if (method.kind !== "builtin_function_or_method") throw new Error("expected method"); return method.value.invoke(args, keywords, meter); };
  return { v, text, keywords, call };
}

describe("native string affix methods", () => {
  it("matches Unicode prefixes and suffixes within code-point bounds", () => {
    const { v, call } = fixture();
    expect(call("startswith", [v.string("😀"), v.integer(1)])).toBe(v.true);
    expect(call("endswith", [v.string("b"), v.integer(1), v.integer(-1)])).toBe(v.true);
    expect(call("endswith", [v.string("\ud800"), v.none, v.none])).toBe(v.true);
  });
  it.each(["startswith", "endswith"])("preserves empty-affix and out-of-range behavior for %s", name => {
    const { v, call } = fixture();
    expect(call(name, [v.string(""), v.integer(4)])).toBe(v.true);
    expect(call(name, [v.string(""), v.integer(5)])).toBe(v.false);
    expect(call(name, [v.string(""), v.integer(2), v.integer(1)])).toBe(v.false);
    expect(call(name, [v.tuple([])])).toBe(v.false);
  });
  it("stops before invalid tuple members after a match", () => {
    const { v, call } = fixture();
    expect(call("startswith", [v.tuple([v.string("a"), v.none])])).toBe(v.true);
    expect(call("endswith", [v.tuple([v.string("\ud800"), v.none])])).toBe(v.true);
    expect(() => call("startswith", [v.tuple([v.string("x"), v.none])])).toThrow("tuple for startswith must only contain str, not NoneType");
  });
  it("validates bounds before inspecting candidates", () => {
    const { v, call, keywords } = fixture();
    expect(() => call("startswith", [v.none, v.float(1)])).toThrow("slice indices must be integers or None or have an __index__ method");
    expect(() => call("endswith", [v.none])).toThrow("endswith first arg must be str or a tuple of str, not NoneType");
    expect(() => call("startswith", [])).toThrow("startswith expected at least 1 argument, got 0");
    keywords.items.set(v.string("prefix"), v.string("a"));
    expect(() => call("startswith", [])).toThrow("str.startswith() takes no keyword arguments");
  });
});
