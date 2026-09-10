import { expect, it } from "vitest";
import { beginRuntimeDictionary } from "./runtime-dictionary-display.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";
import { beginRuntimeCall } from "./runtime-call.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue,b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  return { meter, v, keys };
}
it("keeps native display mutation history in positional storage", () => {
  const { meter, v, keys } = fixture(), builder = beginRuntimeDictionary([], v, keys, meter), key = v.string("a"), survivor = v.string("b");
  builder.set(key, v.integer(1)); builder.set(survivor, v.integer(2));
  const result = builder.finish(); if (result.kind !== "dict") throw Error("expected dict");
  result.items.delete(key); builder.set(v.integer(3), v.integer(3));
  expect(result.items.nextDictionaryEntry(0)).toEqual({ position: 1, key: survivor, value: v.integer(2) });
});
it("presizes explicit initial display runs using all supplied pairs including duplicates", () => {
  const { meter, v, keys } = fixture(), key = v.string("a");
  const builder = beginRuntimeDictionary(Array.from({length: 6}, () => [key, v.none] as const), v, keys, meter);
  const result = builder.finish(); if (result.kind !== "dict") throw Error("expected dict");
  result.items.delete(key);
  for (const name of ["b", "c", "d", "e", "f"]) builder.set(v.string(name), v.none);
  expect(result.items.nextDictionaryEntry(0)).toEqual({ position: 2, key: v.string("b"), value: v.none });
});
it("configures dict construction and default fromkeys results", () => {
  const { meter, v, keys } = fixture();
  const result = constructRuntimeDictionary([v.list([v.tuple([v.integer(1), v.integer(2)])])], new Map([["x", v.none]]), v, keys, meter);
  expect(result.items.nextDictionaryEntry(0)).toEqual({ position: 1, key: v.integer(1), value: v.integer(2) });
  const keywords = constructRuntimeDictionary([], new Map(), v, keys, meter);
  const fromkeys = createDictionaryFromKeysBuiltin(v, keys, meter).value.invoke([v.list([v.string("a"), v.string("b")])], keywords, meter);
  if (fromkeys.kind !== "dict") throw Error("expected dict");
  expect(fromkeys.items.nextDictionaryEntry(1)).toEqual({ position: 2, key: v.string("b"), value: v.none });
});
it("configures keyword dictionaries assembled for calls", () => {
  const { meter, v, keys } = fixture();
  const call = beginRuntimeCall(v.none, { values: v, keys, callable: () => true, name: () => "f()", keywordName: () => "x", invoke: (_callee,_args,keywords) => keywords }, meter);
  call.keywords([["x", v.integer(1)]]);
  const result = call.invoke(); if (result.kind !== "dict") throw Error("expected dict");
  expect(result.items.nextDictionaryEntry(0)).toEqual({ position: 1, key: v.string("x"), value: v.integer(1) });
});
it("configures bootstrap type namespaces", () => {
  const { meter, v, keys } = fixture(), registry = new RuntimeTypeRegistry(v, keys, meter);
  expect(registry.object.value.namespace.items.nextDictionaryEntry(0)).toMatchObject({ key: v.string("__new__"), value: { kind: "builtin_function_or_method" } });
  expect(registry.type.value.namespace.items.nextDictionaryEntry(0)).toBeDefined();
});
