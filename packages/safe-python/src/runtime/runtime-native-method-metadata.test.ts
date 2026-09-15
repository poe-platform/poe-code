import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { readRuntimeNativeMethodMetadata } from "./runtime-native-method-metadata.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value }, registry = new RuntimeTypeRegistry(v, keys, meter);
  const type = (name: string) => registry.publish(new RuntimeTypeLayout(name, [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter), registry.type);
  const owner = type("C"), capability = { owner, name: "field", accepts: () => true, invoke: () => v.none, get: () => v.none };
  return { meter, v, owner, type, capability, registry };
}

it("reflects missing descriptor documentation as None without owner lookups", () => {
  const { meter, v, capability } = fixture();
  for (const value of [v.methodDescriptor(capability), v.classMethodDescriptor(capability), v.wrapperDescriptor(capability), v.getsetDescriptor(capability), v.memberDescriptor(capability)]) {
    expect(readRuntimeNativeMethodMetadata(value, "__doc__", v, meter, { attribute() { throw Error("unexpected owner lookup"); } })).toBe(v.none);
  }
});

it("exposes canonical wrapper documentation on descriptors and their bound methods", () => {
  const { meter, v, registry } = fixture(), descriptor = registry.object.value.namespace.items.lookup(v.string("__init__"))!.value;
  if (descriptor.kind !== "wrapper_descriptor") throw Error("expected wrapper descriptor");
  const bound = getRuntimeMethodDescriptor(descriptor, v.true, v.none, v, meter);
  for (const value of [descriptor, bound]) expect(readRuntimeNativeMethodMetadata(value, "__doc__", v, meter)).toEqual(v.string("Initialize self.  See help(type(self)) for accurate signature."));
});

it.each(["", "Native documentation.\nSecond line."])("preserves explicit documentation %j on native bindings and descriptors", doc => {
  const { meter, v, capability } = fixture(), documented = { ...capability, doc };
  const method = v.methodDescriptor(documented), bound = getRuntimeMethodDescriptor(method, v.true, v.none, v, meter);
  for (const value of [method, bound, v.getsetDescriptor(documented), v.memberDescriptor(documented), v.builtinFunction({ name: "native", doc, invoke: () => v.none })]) {
    expect(readRuntimeNativeMethodMetadata(value, "__doc__", v, meter)).toEqual(v.string(doc));
  }
  const wrapper = v.wrapperDescriptor({ ...documented, name: "__init__" });
  expect(readRuntimeNativeMethodMetadata(wrapper, "__doc__", v, meter)).toEqual(v.string(doc));
});

it("checks cancellation even for missing native documentation", () => {
  const controller = new AbortController(), { meter, v, capability } = fixture(controller.signal), descriptor = v.memberDescriptor(capability);
  controller.abort(); expect(() => readRuntimeNativeMethodMetadata(descriptor, "__doc__", v, meter)).toThrow("execution cancelled");
});

it("caches qualified names independently for all five native descriptor families", () => {
  const { meter, v, owner, capability } = fixture();
  const descriptors = [v.methodDescriptor(capability), v.classMethodDescriptor(capability), v.wrapperDescriptor(capability), v.getsetDescriptor(capability), v.memberDescriptor(capability)];
  const first = descriptors.map(value => readRuntimeNativeMethodMetadata(value, "__qualname__", v, meter));
  owner.value.names.set("__qualname__", v.string("Changed"), meter);
  for (const [index, descriptor] of descriptors.entries()) {
    expect(first[index]).toEqual(v.string("C.field"));
    expect(readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter)).toBe(first[index]);
  }
});

it("shares wrapper qualified-name caches with their descriptors", () => {
  const { meter, v, owner, capability } = fixture(), descriptor = v.wrapperDescriptor(capability), wrapper = v.methodWrapper(descriptor, v.instance(owner));
  const first = readRuntimeNativeMethodMetadata(wrapper, "__qualname__", v, meter);
  owner.value.names.set("__qualname__", v.string("Changed"), meter);
  expect(readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter)).toBe(first);
});

it("uses a bound native method's current receiver type instead of its defining owner", () => {
  const { meter, v, owner, type, capability } = fixture(), first = type("D"), next = type("E"), receiver = v.instance(first), descriptor = v.methodDescriptor(capability);
  const bound = getRuntimeMethodDescriptor(descriptor, receiver, owner, v, meter);
  expect(readRuntimeNativeMethodMetadata(bound, "__qualname__", v, meter)).toEqual(v.string("D.field"));
  receiver.state.assignType(next, meter);
  expect(readRuntimeNativeMethodMetadata(bound, "__qualname__", v, meter)).toEqual(v.string("E.field"));
});

it("preserves Python code points when joining qualified names", () => {
  const { meter, v, capability } = fixture(), descriptor = v.getsetDescriptor(capability), stem = v.stringPoints(new Uint32Array([0xd800, 0xdc00]));
  const result = readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter, { attribute: () => stem });
  if (result?.kind !== "str") throw Error("expected qualified name");
  expect([...result.value].slice(0, 3)).toEqual([0xd800, 0xdc00, 46]);
});

it("discards a nested cache entry when the outer descriptor lookup fails", () => {
  const { meter, v, capability } = fixture(), descriptor = v.getsetDescriptor(capability); let calls = 0, nested = false;
  const context = { attribute() {
    calls++;
    if (!nested) { nested = true; readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter, context); return v.none; }
    return v.string("Inner");
  } };
  expect(() => readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter, context)).toThrow("<descriptor>.__objclass__.__qualname__ is not a unicode object");
  expect(readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter, context)).toEqual(v.string("Inner.field"));
  expect(calls).toBe(3);
});

it("observes cancellation after ordinary owner lookup", () => {
  const controller = new AbortController(), { meter, v, capability } = fixture(controller.signal), descriptor = v.getsetDescriptor(capability), stem = v.string("C");
  expect(() => readRuntimeNativeMethodMetadata(descriptor, "__qualname__", v, meter, { attribute() { controller.abort(); return stem; } })).toThrow("execution cancelled");
});
