import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { allocateRuntimeType } from "./runtime-type-allocation.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), namespace = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const owner = allocateRuntimeType(v.string("C"), [], namespace, registry.type, registry, v, meter);
  const child = allocateRuntimeType(v.string("Child"), [owner], namespace, registry.type, registry, v, meter);
  const descriptor = owner.value.namespace.items.lookup(v.string("__dict__"))!.value;
  if (descriptor.kind !== "getset_descriptor") throw Error("expected dictionary descriptor");
  const dictionary = v.dictionary(namespace.items.emptyCopy()), instance = v.instance(child, dictionary);
  return { meter, v, registry, owner, descriptor, dictionary, instance };
}

it("binds inherited storage and checks the owner before validating assigned values", () => {
  const { meter, v, registry, owner, descriptor, dictionary, instance } = fixture();
  expect(readRuntimeGetsetDescriptor(descriptor, null, owner, meter)).toBe(descriptor);
  expect(readRuntimeGetsetDescriptor(descriptor, instance, owner, meter)).toBe(dictionary);
  const unrelated = v.instance(registry.object);
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, unrelated, { kind: "set", value: v.none }, meter)).toThrow("descriptor '__dict__' for 'C' objects doesn't apply to a 'object' object");
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, unrelated, { kind: "delete" }, meter)).toThrow("descriptor '__dict__' for 'C' objects doesn't apply to a 'object' object");
});

it("preserves live dictionaries after invalid replacement with actual-type diagnostics", () => {
  const { meter, v, descriptor, dictionary, instance } = fixture();
  for (const [value, name] of [[v.none, "NoneType"], [v.integer(1), "int"], [v.list([]), "list"], [instance, "Child"]] as const) {
    expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "set", value }, meter)).toThrow(`__dict__ must be set to a dictionary, not a '${name}'`);
    expect(instance.dictionary).toBe(dictionary);
  }
});

it("creates independent empty dictionaries on repeated deletion", () => {
  const { meter, v, descriptor, dictionary, instance } = fixture(); dictionary.items.set(v.string("retained"), v.true);
  mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "delete" }, meter);
  const first = instance.dictionary!; expect(first.items.size).toBe(0); expect(dictionary.items.size).toBe(1);
  mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "delete" }, meter);
  expect(instance.dictionary === first).toBe(false); expect(instance.dictionary!.items.size).toBe(0);
});

it("checks cancellation before detaching storage", () => {
  const controller = new AbortController(), { meter, v, descriptor, dictionary, instance } = fixture(controller.signal);
  const replacement = v.dictionary(dictionary.items.emptyCopy()); controller.abort();
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "set", value: replacement }, meter)).toThrow(ExecutionLimitError);
  expect(() => mutateRuntimeGetsetDescriptor(descriptor, instance, { kind: "delete" }, meter)).toThrow(ExecutionLimitError);
  expect(instance.dictionary).toBe(dictionary);
});
