import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input = [255, 0, 255, 1]) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, value, keywords, call };
}
function bytes(value: RuntimeValue): number[] {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("removes only complete matching byte prefixes or suffixes", () => {
  const { call, v } = fixture();
  expect(bytes(call("removeprefix", [v.bytes(Uint8Array.of(255, 0))]))).toEqual([255, 1]);
  expect(bytes(call("removesuffix", [v.bytes(Uint8Array.of(255, 1))]))).toEqual([255, 0]);
});

it.each(["removeprefix", "removesuffix"])("retains unchanged receiver identity for bytes.%s", name => {
  const { call, v, value } = fixture();
  expect(call(name, [v.bytes(new Uint8Array())])).toBe(value);
  expect(call(name, [v.bytes(Uint8Array.of(9))])).toBe(value);
  expect(bytes(call(name, [value]))).toEqual([]);
});

it.each([["partition", [], [0, 255, 1]], ["rpartition", [255, 0], [1]]] as const)("partitions at the correct occurrence for bytes.%s", (name, left, right) => {
  const { call, v } = fixture(), sep = v.bytes(Uint8Array.of(255)), result = call(name, [sep]);
  if (result.kind !== "tuple") throw new Error("expected tuple");
  expect(bytes(result.items[0])).toEqual(left); expect(bytes(result.items[2])).toEqual(right);
  expect(result.items[1]).toBe(sep);
});

it.each(["partition", "rpartition"])("preserves missing and empty-receiver identities for bytes.%s", name => {
  for (const input of [[255, 0], []]) {
    const { call, v, value } = fixture(input), result = call(name, [v.bytes(Uint8Array.of(9))]);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result.items[name === "partition" ? 0 : 2]).toBe(value);
    expect(bytes(result.items[1])).toEqual([]);
    expect(result.items[name === "partition" ? 1 : 0]).toBe(result.items[name === "partition" ? 2 : 1]);
    if (input.length === 0) expect(result.items.every(item => item === value)).toBe(true);
  }
});

it("rejects empty partition separators and shares both empty sides of a full match", () => {
  const { call, v, value } = fixture();
  for (const name of ["partition", "rpartition"]) {
    expect(() => call(name, [v.bytes(new Uint8Array())])).toThrow("empty separator");
    const result = call(name, [value]); if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result.items[0]).toBe(result.items[2]); expect(result.items[1]).toBe(value);
  }
});

it.each(["removeprefix", "removesuffix", "partition", "rpartition"])("validates bytes.%s call shape and byte-like arguments", name => {
  const { call, v, keywords } = fixture();
  expect(() => call(name, [v.none])).toThrow("a bytes-like object is required, not 'NoneType'");
  expect(() => call(name, [v.integer(255)])).toThrow("a bytes-like object is required, not 'int'");
  expect(() => call(name, [])).toThrow(`bytes.${name}() takes exactly one argument (0 given)`);
  expect(() => call(name, [v.none, v.none])).toThrow(`bytes.${name}() takes exactly one argument (2 given)`);
  keywords.items.set(v.string("sep"), v.none);
  expect(() => call(name, [])).toThrow(`bytes.${name}() takes no keyword arguments`);
});
