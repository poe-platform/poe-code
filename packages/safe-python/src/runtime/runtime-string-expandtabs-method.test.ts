import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(text, "expandtabs", v, meter);
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

describe("native string tab expansion", () => {
  it("expands to tab stops with default and explicit sizes", () => {
    const { call, v } = fixture("a\tb\t");
    expect(points(call())).toEqual(expected("a       b       "));
    expect(points(call([v.integer(4n)]))).toEqual(expected("a   b   "));
    expect(points(call([v.true]))).toEqual(expected("a b "));
  });
  it("resets columns only at carriage returns and newlines", () => {
    for (const boundary of ["\n", "\r", "\r\n"]) {
      const { call, v } = fixture(`ab${boundary}\tX`);
      expect(points(call([v.integer(4n)]))).toEqual(expected(`ab${boundary}    X`));
    }
    for (const character of ["\v", "\f", "\x1c", "\x85", "\u2028", "😀"]) {
      const { call, v } = fixture(`ab${character}\tX`);
      expect(points(call([v.integer(4n)]))).toEqual(expected(`ab${character} X`));
    }
  });
  it("removes tabs at zero or negative sizes without resetting the column", () => {
    const { call, v } = fixture("a\t\tb\n\tc");
    for (const size of [v.false, v.integer(-1n), v.integer(-2147483648n)]) expect(points(call([size]))).toEqual(expected("ab\nc"));
  });
  it("preserves lone surrogates and counts each as one column", () => {
    const { call, v } = fixture("\ud800\t\udc00");
    expect(points(call([v.integer(3n)]))).toEqual([0xd800, 32, 32, 0xdc00]);
  });
  it("retains exact receiver identity when no tabs occur", () => {
    const { call, v, text } = fixture("no tabs 😀\n");
    expect(call()).toBe(text); expect(call([v.integer(2147483647n)])).toBe(text);
  });
  it("enforces C-int bounds rather than signed-size bounds", () => {
    const { call, v } = fixture("");
    for (const size of [2147483648n, -2147483649n, 1n << 100n]) expect(() => call([v.integer(size)])).toThrow("Python int too large to convert to C int");
    expect(() => call([v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
    expect(() => call([v.float(1)])).toThrow("'float' object cannot be interpreted as an integer");
  });
  it("accepts tabsize by keyword and rejects extra or unknown arguments", () => {
    const { call, v, keywords } = fixture("\t");
    keywords.items.set(v.string("tabsize"), v.integer(2n));
    expect(points(call())).toEqual([32, 32]);
    expect(() => call([v.true])).toThrow("expandtabs() takes at most 1 argument (2 given)");
    keywords.items.set(v.string("bad"), v.true);
    expect(() => call()).toThrow("expandtabs() takes at most 1 keyword argument (2 given)");
    keywords.items.clear(); keywords.items.set(v.string("bad"), v.true);
    expect(() => call()).toThrow("expandtabs() got an unexpected keyword argument 'bad'");
  });
  it("refuses enormous expanded output through the allocation budget", () => {
    const { call, v } = fixture("\t");
    expect(() => call([v.integer(2147483647n)])).toThrow(ExecutionLimitError);
  });
});
