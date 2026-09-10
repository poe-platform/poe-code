import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { allocateRuntimeType } from "./runtime-type-allocation.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  function type(name: string, slots: readonly string[], base = registry.object) {
    const source = dictionary(); source.items.set(v.string("__slots__"), v.tuple(slots.map(name => v.string(name))));
    return allocateRuntimeType(v.string(name), [base], source, registry.type, registry, v, meter);
  }
  function descriptor(owner: TypeValue, name: string) {
    const result = owner.value.namespace.items.lookup(v.string(name))!.value;
    if (result.kind !== "member_descriptor" && result.kind !== "getset_descriptor") throw Error("expected storage descriptor");
    return result;
  }
  return { meter, v, registry, dictionary, type, descriptor };
}

it("keeps inherited and redeclared slots at independent positions", () => {
  const { v, meter, type, descriptor } = fixture(), base = type("Base", ["x"]), child = type("Child", ["x"], base), instance = v.instance(child);
  const inherited = descriptor(base, "x"), own = descriptor(child, "x");
  mutateRuntimeGetsetDescriptor(inherited, instance, { kind: "set", value: v.integer(1) }, meter);
  mutateRuntimeGetsetDescriptor(own, instance, { kind: "set", value: v.none }, meter);
  expect(readRuntimeGetsetDescriptor(inherited, instance, child, meter)).toEqual(v.integer(1));
  expect(readRuntimeGetsetDescriptor(own, instance, child, meter)).toBe(v.none);
  mutateRuntimeGetsetDescriptor(own, instance, { kind: "delete" }, meter);
  expect(() => readRuntimeGetsetDescriptor(own, instance, child, meter)).toThrow("'Child' object has no attribute 'x'");
  expect(readRuntimeGetsetDescriptor(inherited, instance, child, meter)).toEqual(v.integer(1));
  expect(child.value.slotCount).toBe(2);
});

it("retains duplicate positions while publishing the last descriptor", () => {
  const { v, meter, type, descriptor } = fixture(), owner = type("C", ["x", "x"]), instance = v.instance(owner), slot = descriptor(owner, "x");
  expect(owner.value.slotCount).toBe(2);
  mutateRuntimeGetsetDescriptor(slot, instance, { kind: "set", value: v.true }, meter);
  expect(instance.state.slots.get(0)).toBeUndefined(); expect(instance.state.slots.get(1)).toBe(v.true);
});

it.each(["staticmethod", "classmethod"] as const)("stores %s subclass slots separately from wrapper metadata", kind => {
  const { v, meter, registry, type, descriptor } = fixture(), owner = type("C", ["x"], registry.methodDecoratorType(kind)), wrapper = v.methodDecorator(kind, v.none, owner);
  wrapper.state.attributes.set("x", v.false);
  const slot = descriptor(owner, "x"); mutateRuntimeGetsetDescriptor(slot, wrapper, { kind: "set", value: v.true }, meter);
  expect(readRuntimeGetsetDescriptor(slot, wrapper, owner, meter)).toBe(v.true); expect(wrapper.state.attributes.get("x")).toBe(v.false);
});

it("supports explicit dictionary and weak-reference slots without ordinary slot positions", () => {
  const { v, meter, type, descriptor, dictionary } = fixture(), owner = type("C", ["__dict__", "__weakref__"]), storage = dictionary(), instance = v.instance(owner, storage);
  expect(owner.value.slotCount).toBe(0); expect(owner.value.hasInstanceDictionary).toBe(true); expect(owner.value.hasWeakReferences).toBe(true);
  expect(readRuntimeGetsetDescriptor(descriptor(owner, "__dict__"), instance, owner, meter)).toBe(storage);
  const weak = descriptor(owner, "__weakref__"); expect(readRuntimeGetsetDescriptor(weak, instance, owner, meter)).toBe(v.none);
  expect(() => mutateRuntimeGetsetDescriptor(weak, instance, { kind: "set", value: v.none }, meter)).toThrow("is not writable");
});

it("rejects multiple storage-bearing heap bases before class publication", () => {
  const { v, meter, registry, type, dictionary } = fixture(), a = type("A", ["x"]), b = type("B", ["x"]);
  expect(() => allocateRuntimeType(v.string("C"), [a, b], dictionary(), registry.type, registry, v, meter)).toThrow("multiple bases have instance lay-out conflict");
});
