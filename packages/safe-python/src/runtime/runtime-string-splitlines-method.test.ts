import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(text, "splitlines", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, text, keywords, call };
}
function lines(value: RuntimeValue) {
  if (value.kind !== "list") throw new Error("expected list");
  return value.items.snapshot().map(item => {
    if (item.kind !== "str") throw new Error("expected string");
    return [...item.value];
  });
}
function expectedLines(texts: string[]) { return texts.map(text => [...text].map(c => c.codePointAt(0))); }

describe("native string splitlines", () => {
  it("recognizes every Python boundary and treats CRLF as one boundary", () => {
    for (const boundary of ["\n", "\r", "\r\n", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]) {
      const { call, v } = fixture(`a${boundary}b${boundary}`);
      expect(lines(call())).toEqual(expectedLines(["a", "b"]));
      expect(lines(call([v.true]))).toEqual(expectedLines([`a${boundary}`, `b${boundary}`]));
    }
  });
  it("preserves empty interior lines but adds no trailing line", () => {
    expect(lines(fixture("").call())).toEqual([]);
    expect(lines(fixture("\r\n\n\r").call())).toEqual([[], [], []]);
    expect(lines(fixture("a\n\nb").call())).toEqual(expectedLines(["a", "", "b"]));
  });
  it("does not split other whitespace or merge surrogate code points", () => {
    const { call } = fixture("\ud800\n\udc00\t\x1f\u00a0\u2000😀");
    expect(lines(call())).toEqual([[0xd800], [0xdc00, 9, 31, 160, 0x2000, 0x1f600]]);
  });
  it("returns a fresh list while retaining an unsplit exact string", () => {
    const { call, text } = fixture("payload"), first = call(), second = call();
    expect(first === second).toBe(false);
    if (first.kind !== "list") throw new Error("expected list");
    expect(first.items.get(0n)).toBe(text);
  });
  it("uses truth conversion rather than index conversion for keepends", () => {
    const { call, v } = fixture("a\nb");
    for (const value of [v.none, v.false, v.integer(0n), v.float(0), v.string(""), v.list([])]) expect(lines(call([value]))).toEqual(expectedLines(["a", "b"]));
    for (const value of [v.true, v.integer(1n << 100n), v.float(0.5), v.string("x"), v.list([v.none])]) expect(lines(call([value]))).toEqual(expectedLines(["a\n", "b"]));
  });
  it("accepts keepends by keyword and rejects excess or unknown arguments", () => {
    const { call, v, keywords } = fixture("a\n");
    keywords.items.set(v.string("keepends"), v.true);
    expect(lines(call())).toEqual(expectedLines(["a\n"]));
    expect(() => call([v.true])).toThrow("splitlines() takes at most 1 argument (2 given)");
    keywords.items.clear(); keywords.items.set(v.string("other"), v.none);
    expect(() => call()).toThrow("splitlines() got an unexpected keyword argument 'other'");
    keywords.items.set(v.string("keepends"), v.true);
    expect(() => call()).toThrow("splitlines() takes at most 1 keyword argument (2 given)");
  });
  it("performs truth conversion even for empty input", () => {
    const { call, v } = fixture("");
    expect(() => call([v.notImplemented])).toThrow("NotImplemented should not be used in a boolean context");
  });
  it("bounds scan work and charges result slots without a second list copy", () => {
    const { v, text, keywords } = fixture("x\n".repeat(100));
    let steps = 0, allocated = 0;
    const meter: ExecutionMeter = { checkpoint(work = 1, bytes = 0) { steps += work; allocated += bytes; } };
    const method = runtimeNativeAttribute(text, "splitlines", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    const result = method.value.invoke([], keywords, meter);
    expect(steps).toBeLessThan(700);
    expect(allocated).toBeLessThan(1400);
    expect(lines(result)).toHaveLength(100);
    const limited = new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 100000 });
    expect(() => method.value.invoke([], keywords, limited)).toThrow(ExecutionLimitError);
  });
});
