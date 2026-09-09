import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
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
function parts(value: RuntimeValue) {
  if (value.kind !== "list") throw new Error("expected list");
  return value.items.snapshot().map(item => {
    if (item.kind !== "str") throw new Error("expected string");
    return [...item.value];
  });
}
const expected = (texts: string[]) => texts.map(text => [...text].map(c => c.codePointAt(0)));

describe("native string split and rsplit", () => {
  it.each(["split", "rsplit"])("%s preserves explicit empty fields and rejects empty separators", name => {
    const { call, v } = fixture(",a,,b,");
    expect(parts(call(name, [v.string(",")]))).toEqual(expected(["", "a", "", "b", ""]));
    expect(() => call(name, [v.string("")])).toThrow("empty separator");
    const empty = fixture("");
    expect(parts(empty.call(name, [empty.v.string(",")]))).toEqual([[]]);
    expect(parts(empty.call(name))).toEqual([]);
  });
  it("selects nonoverlapping separators from the requested direction", () => {
    const { call, v } = fixture("ababa");
    expect(parts(call("split", [v.string("aba")]))).toEqual(expected(["", "ba"]));
    expect(parts(call("rsplit", [v.string("aba")]))).toEqual(expected(["ab", ""]));
  });
  it("stops at maxsplit and keeps the untouched remainder", () => {
    const { call, v } = fixture("a,b,c");
    expect(parts(call("split", [v.string(","), v.integer(1n)]))).toEqual(expected(["a", "b,c"]));
    expect(parts(call("rsplit", [v.string(","), v.true]))).toEqual(expected(["a,b", "c"]));
  });
  it("uses Python whitespace runs and direction-sensitive zero limits", () => {
    const { call, v } = fixture("\x1c a  b \u3000");
    expect(parts(call("split"))).toEqual(expected(["a", "b"]));
    expect(parts(call("rsplit"))).toEqual(expected(["a", "b"]));
    expect(parts(call("split", [v.none, v.integer(0n)]))).toEqual(expected(["a  b \u3000"]));
    expect(parts(call("rsplit", [v.none, v.integer(0n)]))).toEqual(expected(["\x1c a  b"]));
    expect(parts(call("split", [v.none, v.integer(1n)]))).toEqual(expected(["a", "b \u3000"]));
    expect(parts(call("rsplit", [v.none, v.integer(1n)]))).toEqual(expected(["\x1c a", "b"]));
  });
  it("retains unchanged string identity in a fresh list", () => {
    const { call, text, v } = fixture("payload");
    for (const name of ["split", "rsplit"]) {
      const result = call(name, [v.string(","), v.integer(0n)]);
      if (result.kind !== "list") throw new Error("expected list");
      expect(result.items.get(0n)).toBe(text);
    }
  });
  it("preserves lone surrogate code points around astral separators", () => {
    const { call, v } = fixture("\ud800😀\udc00");
    expect(parts(call("split", [v.string("😀")]))).toEqual([[0xd800], [0xdc00]]);
  });
  it("copies the zero-limit whitespace remainder instead of taking the unsplit fast path", () => {
    for (const source of ["payload", "😀", "a b"]) {
      const { call, text, v } = fixture(source);
      for (const name of ["split", "rsplit"]) {
        const result = call(name, [v.none, v.false]);
        if (result.kind !== "list") throw new Error("expected list");
        expect(result.items.get(0n) === text).toBe(false);
        expect(parts(result)).toEqual(expected([source]));
      }
    }
  });
  it("validates maxsplit before separator type and enforces signed-size bounds", () => {
    const { call, v } = fixture("");
    expect(() => call("split", [v.integer(1n), v.float(1)])).toThrow("'float' object cannot be interpreted as an integer");
    expect(() => call("split", [v.integer(1n)])).toThrow("must be str or None, not int");
    expect(() => call("split", [v.notImplemented])).toThrow("must be str or None, not NotImplementedType");
    expect(() => call("rsplit", [v.none, v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
  });
  it("accepts named options, rejecting duplicates and unexpected names", () => {
    const { call, v, keywords } = fixture("a,b,c");
    keywords.items.set(v.string("maxsplit"), v.integer(1n));
    keywords.items.set(v.string("sep"), v.string(","));
    expect(parts(call("split"))).toEqual(expected(["a", "b,c"]));
    keywords.items.clear(); keywords.items.set(v.string("sep"), v.string(","));
    expect(() => call("split", [v.none])).toThrow("argument for split() given by name ('sep') and position (1)");
    keywords.items.clear(); keywords.items.set(v.string("bad"), v.none);
    expect(() => call("rsplit")).toThrow("rsplit() got an unexpected keyword argument 'bad'");
  });
});
