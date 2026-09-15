import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const descriptor = registry.type.value.namespace.items.lookup(v.string("__call__"))?.value;
  if (descriptor?.kind !== "wrapper_descriptor") throw Error("expected type call wrapper");
  return { v, meter, registry, keywords, descriptor };
}

it("forwards the class, argument sequence and keyword dictionary to default type calling", () => {
  const { v, meter, registry, keywords, descriptor } = fixture(); keywords.items.set(v.string("x"), v.true);
  const context = { callTypeDefault(type: RuntimeValue, args: readonly RuntimeValue[], named: RuntimeValue) { expect(type).toBe(registry.object); expect(args).toEqual([v.false]); expect(named).toBe(keywords); return v.true; }, call: () => v.none, isStopIteration: () => false };
  expect(callRuntimeMethodDescriptor(descriptor, [registry.object, v.false], keywords, meter, context)).toBe(v.true);
});

it("requires an explicit default-call policy rather than redispatching to itself", () => {
  const { meter, registry, keywords, descriptor } = fixture();
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.object], keywords, meter)).toThrow("type calls require a default type-call policy");
});

it("validates the receiver before entering the default-call policy", () => {
  const { v, meter, keywords, descriptor } = fixture();
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.integer(1)], keywords, meter)).toThrow("descriptor '__call__' requires a 'type' object but received a 'int'");
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("descriptor '__call__' of 'type' object needs an argument");
});

it("observes cancellation after default type-call callbacks", () => {
  const controller = new AbortController(), { v, meter, registry, keywords, descriptor } = fixture(controller.signal);
  const context = { callTypeDefault() { controller.abort(); return v.none; }, call: () => v.none, isStopIteration: () => false };
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.object], keywords, meter, context)).toThrow("execution cancelled");
});
