import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeAttributeStorage } from "./runtime-attribute-storage.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 };
  return { meter, v, keys, storage: new RuntimeAttributeStorage(v, meter) };
}

it("promotes once while preserving insertion order, values and live dictionary edits", () => {
  const { v, keys, storage } = fixture(); storage.set("a", v.true); storage.set("b", v.false); storage.set("a", v.none);
  const dictionary = storage.dictionary(keys); expect(storage.dictionary(keys)).toBe(dictionary);
  expect(dictionary.items.snapshot()).toEqual([[v.string("a"), v.none], [v.string("b"), v.false]]);
  dictionary.items.set(v.string("a"), v.true); expect(storage.get("a")).toBe(v.true);
  storage.set("b", v.none); expect(dictionary.items.lookup(v.string("b"))?.value).toBe(v.none);
  expect(storage.delete("a")).toBe(true); expect(dictionary.items.lookup(v.string("a"))).toBeUndefined();
});

it("adopts replacement dictionary key matching without rebuilding keys", () => {
  const { v, meter, storage } = fixture(), key = v.cell({});
  const dictionary = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (stored, incoming) => stored === key && incoming.kind === "str" }, meter));
  dictionary.items.set(key, v.true); storage.replace(dictionary);
  expect(storage.get("x")).toBe(v.true); storage.set("x", v.false);
  expect(dictionary.items.snapshot()).toEqual([[key, v.false]]);
  expect(storage.delete("x")).toBe(true); expect(dictionary.items.size).toBe(0);
});

it("retains unreflected attributes when dictionary construction fails", () => {
  const { v, keys, storage } = fixture(); storage.set("a", v.true); storage.set("b", v.false);
  const error = new Error("hash failure");
  expect(() => storage.dictionary({ ...keys, hash() { throw error; } })).toThrow(error);
  expect(storage.get("a")).toBe(v.true); expect(storage.get("b")).toBe(v.false);
  expect(storage.dictionary(keys).items.size).toBe(2);
});

it("writes remaining wrapper metadata into a dictionary replaced during lookup", () => {
  const { v, meter, keys } = fixture(), wrapper = v.methodDecorator("staticmethod", v.true), old = wrapper.state.attributes.dictionary(keys), replacement = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  wrapper.state.initialize(v.false, (_value, name) => {
    if (name === "__module__") wrapper.state.attributes.replace(replacement);
    return v.true;
  }, meter);
  expect(old.items.size).toBe(0); expect(replacement.items.size).toBe(4);
  expect(wrapper.state.attributes.dictionary(keys)).toBe(replacement);
});
