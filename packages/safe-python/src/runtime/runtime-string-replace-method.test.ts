import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(text, "replace", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, text, keywords, call };
}
function points(value: RuntimeValue) {
  if (value.kind !== "str") throw new Error("expected string");
  return [...value.value];
}
const expected = (text: string) => [...text].map(c => c.codePointAt(0));

describe("native string replacement", () => {
  it("replaces nonoverlapping matches from left to right without rescanning replacements", () => {
    const { call, v } = fixture("ababa");
    expect(points(call([v.string("aba"), v.string("X")]))).toEqual(expected("Xba"));
    expect(points(call([v.string("a"), v.string("aa")]))).toEqual(expected("aabaabaa"));
  });
  it("honors positive, negative and Boolean counts", () => {
    const { call, v } = fixture("aaa");
    expect(points(call([v.string("a"), v.string("b"), v.true]))).toEqual(expected("baa"));
    expect(points(call([v.string("a"), v.string("b"), v.integer(-2n)]))).toEqual(expected("bbb"));
    expect(points(call([v.string("a"), v.string(""), v.integer(2n)]))).toEqual(expected("a"));
  });
  it("inserts at code-point boundaries for an empty pattern, including empty input", () => {
    const { call, v } = fixture("a😀b");
    expect(points(call([v.string(""), v.string("-")]))).toEqual(expected("-a-😀-b-"));
    expect(points(call([v.string(""), v.string("-"), v.integer(2n)]))).toEqual(expected("-a-😀b"));
    const empty = fixture("");
    expect(points(empty.call([empty.v.string(""), empty.v.string("X")]))).toEqual([88]);
  });
  it("preserves lone surrogate code points", () => {
    const { call, v } = fixture("\ud800😀\udc00");
    expect(points(call([v.string("😀"), v.string("\udc00\ud800")]))).toEqual([0xd800, 0xdc00, 0xd800, 0xdc00]);
  });
  it("retains exact receiver identity for no-op replacements", () => {
    const { call, v, text } = fixture("payload");
    const same = v.string("pay");
    for (const args of [[v.string("missing"), v.string("x")], [same, same], [v.string(""), v.string("")], [v.string("p"), v.string("x"), v.false]]) expect(call(args)).toBe(text);
  });
  it("validates old and new before count, even when no replacement could occur", () => {
    const { call, v } = fixture("");
    expect(() => call([v.integer(1n), v.none, v.float(1)])).toThrow("replace() argument 1 must be str, not int");
    expect(() => call([v.string("a"), v.integer(1n), v.none])).toThrow("replace() argument 2 must be str, not int");
    expect(() => call([v.string("a"), v.string("b"), v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
    expect(() => call([v.string("a"), v.string("b"), v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
  });
  it("does not turn distinct equal replacement objects into an identity no-op", () => {
    const { call, v, text } = fixture("payloadpayload");
    const result = call([v.string("payload"), v.string("payload")]);
    expect(result === text).toBe(false);
    expect(points(result)).toEqual(expected("payloadpayload"));
  });
  it("accepts count by keyword while old and new remain positional-only", () => {
    const { call, v, keywords } = fixture("aaa");
    keywords.items.set(v.string("count"), v.integer(1n));
    expect(points(call([v.string("a"), v.string("b")]))).toEqual(expected("baa"));
    expect(() => call([v.string("a"), v.string("b"), v.true])).toThrow("replace() takes at most 3 arguments (4 given)");
    keywords.items.clear(); keywords.items.set(v.string("old"), v.string("a"));
    expect(() => call([])).toThrow("replace() takes at least 2 positional arguments (0 given)");
    expect(() => call([v.string("a"), v.string("b")])).toThrow("replace() got an unexpected keyword argument 'old'");
  });
});
