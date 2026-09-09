import { describe, expect, it } from "vitest";
import { ExecutionBudget, type ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(text, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, text, keywords, call };
}
function points(value: RuntimeValue) {
  if (value.kind !== "str") throw new Error("expected string");
  return [...value.value];
}

describe("native string stripping", () => {
  it.each([["strip", "a"], ["lstrip", "a \u3000"], ["rstrip", "\u001c a"]])("strips the selected boundaries with %s", (name, expected) => {
    const { call, v } = fixture("\u001c a \u3000");
    expect(points(call(name))).toEqual([...expected].map(c => c.codePointAt(0)));
    expect(points(call(name, [v.none]))).toEqual(points(call(name)));
  });
  it("treats chars as a set of code points, not a substring", () => {
    const { call, v } = fixture("😀ab😀Xba😀");
    expect(points(call("strip", [v.string("b😀a😀")]))).toEqual([88]);
  });
  it("does not treat BOM or zero-width space as whitespace", () => {
    for (const source of ["\ufeff", "\u200b", "", "payload"]) {
      const { call, text, v } = fixture(source);
      expect(call("strip")).toBe(text);
      expect(call("strip", [v.string("")])).toBe(text);
    }
  });
  it("preserves lone surrogates and strips complete astral points", () => {
    const { call, v } = fixture("😀\ud800x\udc00😀");
    expect(points(call("strip", [v.string("😀")]))).toEqual([0xd800, 120, 0xdc00]);
  });
  it("validates arguments even for empty receivers", () => {
    const { call, v, keywords } = fixture("");
    expect(() => call("strip", [v.integer(1n)])).toThrow("strip arg must be None or str");
    expect(() => call("rstrip", [v.none, v.none])).toThrow("rstrip expected at most 1 argument, got 2");
    keywords.items.set(v.string("chars"), v.none);
    expect(() => call("lstrip")).toThrow("str.lstrip() takes no keyword arguments");
  });
  it("does not scan or copy an unchanged long interior", () => {
    const { v, text, keywords } = fixture("x".repeat(2000));
    const meter = new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 96 });
    const method = runtimeNativeAttribute(text, "strip", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(method.value.invoke([], keywords, meter)).toBe(text);
  });
  it("charges only unique character-set entries and scans boundaries linearly", () => {
    const { v, text, keywords } = fixture("a".repeat(1000) + "x" + "a".repeat(1000));
    const chars = v.string("a".repeat(1000));
    let steps = 0, allocated = 0;
    const meter: ExecutionMeter = { checkpoint(work = 1, bytes = 0) { steps += work; allocated += bytes; } };
    const method = runtimeNativeAttribute(text, "strip", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(points(method.value.invoke([chars], keywords, meter))).toEqual([120]);
    expect(steps).toBeLessThan(3100);
    expect(allocated).toBeLessThan(200);
  });
});
