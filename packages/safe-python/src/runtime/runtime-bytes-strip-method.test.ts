import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input = [32, 9, 65, 160, 32]) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[] = [], receiver = value) => {
    const method = runtimeNativeAttribute(receiver, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, value, keywords, call };
}

it.each([["strip", [65, 160]], ["lstrip", [65, 160, 32]], ["rstrip", [32, 9, 65, 160]]] as const)("implements ASCII whitespace bytes.%s", (name, expected) => {
  const { call, v } = fixture();
  for (const args of [[], [v.none]]) {
    const result = call(name, args); if (result.kind !== "bytes") throw new Error("expected bytes");
    expect([...result.value]).toEqual(expected);
  }
});

it.each(["strip", "lstrip", "rstrip"])("treats custom chars as a byte set for %s", name => {
  const { call, v, value } = fixture([0, 255, 0, 255]);
  expect(call(name, [v.bytes(Uint8Array.of(255, 0, 255))])).toBe(v.bytes(new Uint8Array()));
  expect(call(name, [v.bytes(new Uint8Array())])).toBe(value);
});

it("preserves unchanged fresh objects and canonicalizes trimmed single bytes", () => {
  const { call, v } = fixture([32, 65, 32]), canonical = v.bytes(Uint8Array.of(65));
  expect(call("strip")).toBe(canonical);
  for (const value of [v.bytes(Uint8Array.of(65), "fresh"), v.bytes(new Uint8Array(), "fresh")]) {
    for (const name of ["strip", "lstrip", "rstrip"]) expect(call(name, [], value)).toBe(value);
  }
});

it.each(["strip", "lstrip", "rstrip"])("validates bytes.%s call shape and chars", name => {
  const { call, v, keywords } = fixture([]);
  expect(() => call(name, [v.integer(32)])).toThrow("a bytes-like object is required, not 'int'");
  expect(() => call(name, [v.string(" ")])).toThrow("a bytes-like object is required, not 'str'");
  expect(() => call(name, [v.none, v.none])).toThrow(`${name} expected at most 1 argument, got 2`);
  keywords.items.set(v.string("chars"), v.none);
  expect(() => call(name)).toThrow(`bytes.${name}() takes no keyword arguments`);
});
