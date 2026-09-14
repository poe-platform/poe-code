import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor, getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

const slots = ["__getattribute__", "__setattr__", "__delattr__"] as const;
function fixture(name: typeof slots[number], signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const target = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter), registry.type);
  const descriptor = registry.type.value.namespace.items.lookup(v.string(name))?.value;
  if (descriptor?.kind !== "wrapper_descriptor") throw Error("expected native attribute wrapper");
  return { v, meter, registry, target, keywords, descriptor };
}

it.each(slots)("validates receiver, keyword and arity order for %s", name => {
  const { v, meter, registry, keywords, descriptor } = fixture(name);
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow(`descriptor '${name}' of 'type' object needs an argument`);
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.true], keywords, meter)).toThrow(`descriptor '${name}' requires a 'type' object but received a 'bool'`);
  for (let count = 0; count < 4; count++) {
    if (count === (name === "__setattr__" ? 2 : 1)) continue;
    const args = [registry.object, ...Array<RuntimeValue>(count).fill(v.none)];
    expect(() => callRuntimeMethodDescriptor(descriptor, args, keywords, meter)).toThrow(name === "__setattr__" ? `__setattr__ expected 2 arguments, got ${count}` : `expected 1 argument, got ${count}`);
  }
  keywords.items.set(v.string("name"), v.none);
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.object], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
});

it.each(slots)("validates mutable type string names without coercion for %s", name => {
  const { v, meter, target, keywords, descriptor } = fixture(name);
  const args = name === "__setattr__" ? [target, v.integer(1), v.true] : [target, v.integer(1)];
  expect(() => callRuntimeMethodDescriptor(descriptor, args, keywords, meter)).toThrow("attribute name must be string, not 'int'");
});

it.each(slots)("forwards bound %s through default policy and preserves assigned identity", name => {
  const { v, meter, registry, target, keywords, descriptor } = fixture(name), key = v.string("x𐀀\u0000y"), assigned = v.list([]);
  const bound = getRuntimeMethodDescriptor(descriptor, target, registry.type, v, meter);
  if (bound.kind !== "method-wrapper") throw Error("expected bound wrapper");
  let calls = 0;
  const context = { call: () => { throw Error("must not redispatch"); }, isStopIteration: () => false,
    typeAttributeDefault(type: RuntimeValue, attribute: string) { calls++; expect(type).toBe(target); expect(attribute).toBe("x𐀀\u0000y"); return assigned; },
    mutateTypeAttributeDefault(type: RuntimeValue, attribute: string, change: { kind: "set"; value: RuntimeValue } | { kind: "delete" }) { calls++; expect(type).toBe(target); expect(attribute).toBe("x𐀀\u0000y"); expect(change.kind).toBe(name === "__setattr__" ? "set" : "delete"); if (change.kind === "set") expect(change.value).toBe(assigned); }
  };
  expect(callRuntimeMethodDescriptor(bound, name === "__setattr__" ? [key, assigned] : [key], keywords, meter, context)).toBe(name === "__getattribute__" ? assigned : v.none);
  expect(calls).toBe(1);
});

it.each(slots)("requires a default execution policy for %s", name => {
  const { v, meter, target, keywords, descriptor } = fixture(name);
  expect(() => callRuntimeMethodDescriptor(descriptor, name === "__setattr__" ? [target, v.string("x"), v.none] : [target, v.string("x")], keywords, meter)).toThrow(name === "__getattribute__" ? "type attribute reads require a default attribute policy" : "type attribute mutation requires a default attribute policy");
});

it.each(slots)("observes cancellation after default %s callbacks", name => {
  const controller = new AbortController(), { v, meter, target, keywords, descriptor } = fixture(name, controller.signal);
  const context = { call: () => v.none, isStopIteration: () => false, typeAttributeDefault() { controller.abort(); return v.none; }, mutateTypeAttributeDefault() { controller.abort(); } };
  expect(() => callRuntimeMethodDescriptor(descriptor, name === "__setattr__" ? [target, v.string("x"), v.none] : [target, v.string("x")], keywords, meter, context)).toThrow("execution cancelled");
});
