import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(meter: ExecutionMeter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 })) {
  const v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (source: RuntimeValue) => { const method = runtimeNativeAttribute(v.string("😀"), "join", v, meter); if (method.kind !== "builtin_function_or_method") throw new Error("expected method"); return method.value.invoke([source], keywords, meter); };
  return { v, call, keywords };
}

describe("native string join", () => {
  it("observes cancellation immediately after pulling a source element", () => {
    let cancelled = false, calls = 0;
    const { v, call } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    const source = v.iterator({ next() { calls++; cancelled = true; return { done: false, value: v.none }; } });
    expect(() => call(source)).toThrow(ExecutionLimitError); expect(calls).toBe(1);
  });
  it("joins code points without merging lone surrogates into an astral character", () => {
    const { v, call } = fixture(), result = call(v.tuple([v.string("\ud800"), v.string("\udc00")]));
    if (result.kind !== "str") throw new Error("expected string");
    expect([...result.value]).toEqual([0xd800, 0x1f600, 0xdc00]);
  });
  it("retains singleton string identity and handles empty input", () => {
    const { v, call } = fixture(), value = v.string("abc");
    expect(call(v.list([value]))).toBe(value);
    const result = call(v.tuple([])); if (result.kind !== "str") throw new Error("expected string");
    expect(result.value.length).toBe(0);
  });
  it("fully consumes a generic iterable before reporting an invalid element", () => {
    const { v, call } = fixture(), source = [v.string("a"), v.none, v.string("b")][Symbol.iterator]();
    expect(() => call(v.iterator(source))).toThrow("sequence item 1: expected str instance, NoneType found");
    expect(source.next().done).toBe(true);
  });
  it("preserves iteration failure precedence over invalid collected elements", () => {
    const { v, call } = fixture(); let step = 0;
    const source = v.iterator({ next() { if (step++ === 0) return { done: false, value: v.none }; throw new Error("next failed"); } });
    expect(() => call(source)).toThrow("next failed");
  });
  it("does not translate a TypeError raised by next into a noniterable error", () => {
    const { v, call } = fixture(), source = v.iterator({ next() { throw new TypeError("next type error"); } });
    expect(() => call(source)).toThrow("next type error");
    expect(() => call(v.none)).toThrow("can only join an iterable");
  });
  it("iterates a string by code point and rejects keywords", () => {
    const { v, call, keywords } = fixture(), result = call(v.string("ab"));
    if (result.kind !== "str") throw new Error("expected string");
    expect([...result.value]).toEqual([97, 0x1f600, 98]);
    keywords.items.set(v.string("iterable"), v.none);
    expect(() => call(v.none)).toThrow("str.join() takes no keyword arguments");
  });
});
