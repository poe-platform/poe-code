import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string, name: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(text, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, text, keywords, call };
}

it.each([
  ["upper", "Straße ﬃ µ 𐐨", "STRASSE FFI Μ 𐐀"],
  ["casefold", "Straße ẞ İ Σς ﬃ K", "strasse ss i\u0307 σσ ffi k"]
])("implements full Unicode %s mappings", (name, source, expected) => {
  const result = fixture(source, name).call();
  if (result.kind !== "str") throw new Error("expected string");
  expect([...result.value]).toEqual([...expected].map(c => c.codePointAt(0)));
});

it.each(["upper", "casefold"])("preserves only empty receiver identity for %s", name => {
  const empty = fixture("", name); expect(empty.call()).toBe(empty.text);
  const unchanged = fixture("123变量\ud800", name), result = unchanged.call();
  expect(result === unchanged.text).toBe(false);
  if (result.kind !== "str") throw new Error("expected string");
  expect([...result.value]).toEqual([...unchanged.text.value]);
});

it.each(["upper", "casefold"])("rejects arguments and keywords for %s", name => {
  const { call, v, keywords } = fixture("", name);
  expect(() => call([v.true])).toThrow(`str.${name}() takes no arguments (1 given)`);
  keywords.items.set(v.string("x"), v.true);
  expect(() => call()).toThrow(`str.${name}() takes no keyword arguments`);
});
