import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.of(0, 255, 1, 128));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, keywords, call };
}

it("matches unsigned byte boundaries within normalized windows", () => {
  const { v, call } = fixture();
  expect(call("startswith", [v.bytes(Uint8Array.of(255)), v.integer(1)])).toBe(v.true);
  expect(call("endswith", [v.bytes(Uint8Array.of(1)), v.integer(1), v.integer(-1)])).toBe(v.true);
  expect(call("endswith", [v.bytes(Uint8Array.of(128)), v.none, v.none])).toBe(v.true);
  expect(call("startswith", [v.bytes(Uint8Array.of(0)), v.integer(-(1n << 100n)), v.integer(1n << 100n)])).toBe(v.true);
});

it.each(["startswith", "endswith"])("handles empty affixes and out-of-range windows for bytes.%s", name => {
  const { v, call } = fixture(), empty = v.bytes(new Uint8Array());
  expect(call(name, [empty, v.integer(4)])).toBe(v.true);
  expect(call(name, [empty, v.integer(5)])).toBe(v.false);
  expect(call(name, [empty, v.integer(2), v.integer(1)])).toBe(v.false);
  expect(call(name, [v.tuple([])])).toBe(v.false);
});

it("validates tuple members lazily and uses bytes-like diagnostics", () => {
  const { v, call } = fixture();
  expect(call("startswith", [v.tuple([v.bytes(Uint8Array.of(0)), v.none])])).toBe(v.true);
  expect(call("endswith", [v.tuple([v.bytes(Uint8Array.of(128)), v.integer(1)])])).toBe(v.true);
  expect(() => call("startswith", [v.tuple([v.bytes(Uint8Array.of(9)), v.none])])).toThrow("a bytes-like object is required, not 'NoneType'");
  expect(() => call("endswith", [v.tuple([v.integer(128)])])).toThrow("a bytes-like object is required, not 'int'");
});

it("converts bounds before candidates but rejects call shape first", () => {
  const { v, call, keywords } = fixture();
  expect(() => call("startswith", [v.none, v.float(1)])).toThrow("slice indices must be integers or None or have an __index__ method");
  expect(() => call("startswith", [v.tuple([]), v.float(1)])).toThrow("slice indices must be integers or None or have an __index__ method");
  expect(() => call("endswith", [v.none])).toThrow("endswith first arg must be bytes or a tuple of bytes, not NoneType");
  expect(() => call("startswith", [])).toThrow("startswith expected at least 1 argument, got 0");
  expect(() => call("endswith", [v.none, v.none, v.none, v.none])).toThrow("endswith expected at most 3 arguments, got 4");
  keywords.items.set(v.string("prefix"), v.none);
  expect(() => call("startswith", [])).toThrow("bytes.startswith() takes no keyword arguments");
});
