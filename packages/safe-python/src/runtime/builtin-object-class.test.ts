import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const type = (name: string, objectLayout = true) => registry.publish(new RuntimeTypeLayout(name, [registry.object.value], dictionary(), meter, { objectLayout }), registry.type);
  const cls = type("C"), next = type("D"), storage = dictionary(), instance = v.instance(cls, storage);
  const descriptor = registry.object.value.namespace.items.lookup(v.string("__class__"))!.value;
  if (descriptor.kind !== "getset_descriptor") throw Error("expected class descriptor");
  return { v, meter, registry, type, cls, next, storage, instance, descriptor };
}

it("reads owned actual identities without consulting dictionary shadows or host policies", () => {
  const { v, meter, registry, cls, storage, instance, descriptor } = fixture(); storage.items.set(v.string("__class__"), v.none);
  expect(readRuntimeGetsetDescriptor(descriptor, instance, cls, meter)).toBe(cls);
  expect(readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toBe(registry.type);
  expect(readRuntimeGetsetDescriptor(descriptor, null, registry.object, meter)).toBe(descriptor);
  expect(Object.isFrozen(instance)).toBe(true); expect(Object.isFrozen(cls)).toBe(true);
});

it("rejects foreign runtime types before publishing any state change", () => {
  const { meter, cls, instance, descriptor } = fixture(), foreign = fixture();
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "set", value: foreign.next }, meter)).toThrow("type layout is not published in this registry");
  expect(instance.type).toBe(cls);
});

it("distinguishes native payload ancestry even when dictionary flags match", () => {
  const { v, meter, type, descriptor } = fixture(), first = type("First", false), second = type("Second", false), instance = v.instance(first);
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "set", value: second }, meter)).toThrow("__class__ assignment: 'Second' object layout differs from 'First'");
  expect(instance.type).toBe(first);
});

it("rejects reassignment across an additional native payload layer", () => {
  const { v, meter, registry, type, storage, descriptor } = fixture(), root = type("Native", false);
  const larger = registry.publish(new RuntimeTypeLayout("Larger", [root.value], storage, meter, { objectLayout: false }), registry.type);
  const first = registry.publish(new RuntimeTypeLayout("D", [root.value], storage, meter), registry.type);
  const second = registry.publish(new RuntimeTypeLayout("T", [larger.value], storage, meter), registry.type);
  const instance = v.instance(first);
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "set", value: second }, meter)).toThrow("__class__ assignment: 'T' object layout differs from 'D'");
  expect(instance.type).toBe(first);
});

it("passes validated opaque storage changes to the explicit execution policy", () => {
  const { v, meter, cls, next, descriptor } = fixture(), opaque = v.cell({}); let actual = cls, calls = 0;
  const invocation = { call: () => v.none, isStopIteration: () => false, actualType: () => actual,
    assignClassDefault(value: RuntimeValue, type: typeof cls) { expect(value).toBe(opaque); actual = type; calls++; }
  };
  expect(readRuntimeGetsetDescriptor(descriptor, opaque, cls, meter, invocation)).toBe(cls);
  mutateRuntimeGetsetDescriptor(descriptor, opaque, { kind: "set", value: next }, meter, invocation);
  expect(readRuntimeGetsetDescriptor(descriptor, opaque, cls, meter, invocation)).toBe(next); expect(calls).toBe(1);
});

it("observes cancellation after actual-type callbacks before changing storage", () => {
  const controller = new AbortController(), { v, meter, cls, next, descriptor } = fixture(controller.signal), opaque = v.cell({}); let calls = 0;
  const invocation = { call: () => v.none, isStopIteration: () => false,
    actualType() { controller.abort(); return cls; }, assignClassDefault() { calls++; }
  };
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, opaque, { kind: "set", value: next }, meter, invocation)).toThrow("execution cancelled");
  expect(calls).toBe(0);
});
