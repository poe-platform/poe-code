import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
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

describe("native basic Unicode string classifications", () => {
  it("accepts empty ASCII but not empty whitespace or identifiers", () => {
    const { call, v } = fixture("");
    expect(call("isascii")).toBe(v.true); expect(call("isspace")).toBe(v.false); expect(call("isidentifier")).toBe(v.false);
  });
  it("includes every ASCII control code but excludes all non-ASCII points", () => {
    const ascii = fixture(String.fromCodePoint(...Array.from({ length: 128 }, (_, i) => i)));
    expect(ascii.call("isascii")).toBe(ascii.v.true);
    for (const source of ["\x80", "µ", "😀", "\ud800"]) { const { call, v } = fixture(source); expect(call("isascii")).toBe(v.false); }
  });
  it("uses Python's whitespace classes rather than host trim", () => {
    const spaces = fixture("\t\n\r\x1c\x1f\x85\xa0\u1680\u2000\u2028\u202f\u205f\u3000");
    expect(spaces.call("isspace")).toBe(spaces.v.true);
    for (const source of [" \ufeff", "\u200b", " a", "\ud800"]) { const { call, v } = fixture(source); expect(call("isspace")).toBe(v.false); }
  });
  it("recognizes Unicode identifiers without rejecting keywords", () => {
    for (const source of ["_", "def", "class", "True", "变量1", "a\u0301", "a·b", "a\u200c", "a\u200d", "K", "ａ", "𐐀"]) {
      const { call, v } = fixture(source); expect(call("isidentifier")).toBe(v.true);
    }
    for (const source of ["1a", "\u0301a", "a b", "\u200c", "\u200d", "\ud800", "😀", "a\x00"]) {
      const { call, v } = fixture(source); expect(call("isidentifier")).toBe(v.false);
    }
  });
  it.each(["isascii", "isspace", "isidentifier"])("rejects arguments and keywords for %s", name => {
    const { call, v, keywords } = fixture("");
    expect(() => call(name, [v.true])).toThrow(`str.${name}() takes no arguments (1 given)`);
    keywords.items.set(v.string("x"), v.true);
    expect(() => call(name)).toThrow(`str.${name}() takes no keyword arguments`);
  });
  it("short-circuits at the first failure without copying string storage", () => {
    const { v, text, keywords } = fixture("😀" + "x".repeat(2000));
    const meter = new ExecutionBudget({ maxSteps: 4, maxAllocatedBytes: 64 });
    const method = runtimeNativeAttribute(text, "isascii", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(method.value.invoke([], keywords, meter)).toBe(v.false);
  });
  it("checks the execution budget while scanning valid input", () => {
    const { v, text, keywords } = fixture("a".repeat(2000));
    const meter = new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 64 });
    const method = runtimeNativeAttribute(text, "isidentifier", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(() => method.value.invoke([], keywords, meter)).toThrow(ExecutionLimitError);
  });
});
