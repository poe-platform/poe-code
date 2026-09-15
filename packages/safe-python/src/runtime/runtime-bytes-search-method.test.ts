import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input = [0, 255, 0, 255]) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, keywords, call };
}

it.each([["find", 1], ["rfind", 3], ["index", 1], ["rindex", 3], ["count", 2]] as const)("implements bytes.%s for byte strings and integers", (name, expected) => {
  const { v, call } = fixture();
  for (const needle of [v.bytes(Uint8Array.of(255)), v.integer(255)]) expect(call(name, [needle])).toEqual(v.integer(expected));
});

it("normalizes None, negative and arbitrary-size bounds", () => {
  const { v, call } = fixture();
  expect(call("find", [v.integer(255), v.none, v.none])).toEqual(v.integer(1));
  expect(call("rfind", [v.integer(0), v.integer(-(1n << 100n)), v.integer(1n << 100n)])).toEqual(v.integer(2));
  expect(call("find", [v.integer(255), v.integer(-2)])).toEqual(v.integer(3));
  expect(call("find", [v.false])).toEqual(v.integer(0));
});

it("handles empty needles and start positions beyond the end", () => {
  const { v, call } = fixture(), empty = v.bytes(new Uint8Array());
  expect(call("count", [empty])).toEqual(v.integer(5));
  expect(call("find", [empty, v.integer(4)])).toEqual(v.integer(4));
  expect(call("count", [empty, v.integer(5)])).toEqual(v.integer(0));
  expect(() => call("rindex", [empty, v.integer(5)])).toThrow("subsection not found");
});

it("counts nonoverlapping byte strings", () => {
  const { v, call } = fixture([97, 97, 97, 97, 97]), needle = v.bytes(Uint8Array.of(97, 97));
  expect(call("count", [needle])).toEqual(v.integer(2));
  expect(call("rindex", [needle])).toEqual(v.integer(3));
  expect(() => call("index", [v.integer(255)])).toThrow("subsection not found");
});

it("validates bounds before the needle and rejects non-byte integers", () => {
  const { v, call } = fixture();
  for (const needle of [v.none, v.integer(256)]) expect(() => call("find", [needle, v.float(1)])).toThrow("slice indices must be integers or None or have an __index__ method");
  for (const needle of [-1n, 256n, 1n << 100n]) expect(() => call("count", [v.integer(needle)])).toThrow("byte must be in range(0, 256)");
  expect(() => call("find", [v.none])).toThrow("argument should be integer or bytes-like object, not 'NoneType'");
  expect(() => call("find", [v.string("a")])).toThrow("argument should be integer or bytes-like object, not 'str'");
});

it("checks call arity and rejects keywords", () => {
  const { v, call, keywords } = fixture();
  expect(() => call("find", [])).toThrow("find expected at least 1 argument, got 0");
  expect(() => call("count", [v.none, v.none, v.none, v.none])).toThrow("count expected at most 3 arguments, got 4");
  keywords.items.set(v.string("sub"), v.bytes(new Uint8Array()));
  expect(() => call("find", [])).toThrow("bytes.find() takes no keyword arguments");
});
