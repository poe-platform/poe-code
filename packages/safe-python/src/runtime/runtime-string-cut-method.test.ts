import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source = "😀a😀b") {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => { const method = runtimeNativeAttribute(text, name, v, meter); if (method.kind !== "builtin_function_or_method") throw new Error("expected method"); return method.value.invoke(args, keywords, meter); };
  return { v, text, keywords, call };
}

function expectText(value: RuntimeValue, expected: string) {
  expect(value.kind).toBe("str");
  if (value.kind !== "str") throw new Error("expected string");
  expect([...value.value]).toEqual([...expected].map(character => character.codePointAt(0)));
}

describe("native string removal and partitioning", () => {
  it("removes only a matching complete prefix or suffix", () => {
    const { v, call } = fixture();
    expectText(call("removeprefix", [v.string("😀a")]), "😀b");
    expectText(call("removesuffix", [v.string("😀b")]), "😀a");
  });
  it.each(["removeprefix", "removesuffix"])("preserves exact receiver identity for unchanged %s", name => {
    const { v, text, call } = fixture();
    expect(call(name, [v.string("")])).toBe(text); expect(call(name, [v.string("missing")])).toBe(text);
  });
  it.each([["partition", "", "a😀b"], ["rpartition", "😀a", "b"]] as const)("splits %s at the correct occurrence and retains separator identity", (name, left, right) => {
    const { v, call } = fixture(), separator = v.string("😀"), result = call(name, [separator]);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expectText(result.items[0], left); expectText(result.items[2], right); expect(result.items[1]).toBe(separator);
  });
  it("places the original receiver on the correct side when absent", () => {
    const { v, text, call } = fixture();
    for (const name of ["partition", "rpartition"]) {
      const result = call(name, [v.string("missing")]); if (result.kind !== "tuple") throw new Error("expected tuple");
      expect(result.items[name === "partition" ? 0 : 2]).toBe(text);
      expectText(result.items[1], "");
    }
  });
  it("rejects empty separators but permits complete removal", () => {
    const { v, text, call } = fixture();
    expect(() => call("partition", [v.string("")])).toThrow("empty separator");
    expect(() => call("rpartition", [v.string("")])).toThrow("empty separator");
    expectText(call("removeprefix", [text]), "");
  });
  it("retains the distinct None argument diagnostics and validates arity/keywords", () => {
    const { v, keywords, call } = fixture();
    expect(() => call("removeprefix", [v.none])).toThrow(expect.objectContaining({ message: "removeprefix() argument must be str, not None" }));
    expect(() => call("partition", [v.none])).toThrow(expect.objectContaining({ message: "must be str, not NoneType" }));
    expect(() => call("partition", [])).toThrow("str.partition() takes exactly one argument (0 given)");
    keywords.items.set(v.string("sep"), v.string("a"));
    expect(() => call("partition", [])).toThrow("str.partition() takes no keyword arguments");
  });
});
