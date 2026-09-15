import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor, getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const meta = registry.publish(new RuntimeTypeLayout("Meta", [registry.type.value], v.dictionary(keywords.items.emptyCopy()), meter), registry.type);
  const descriptor = registry.type.value.namespace.items.lookup(v.string("__prepare__"))!.value;
  if (descriptor.kind !== "classmethod_descriptor") throw Error("expected native class-method descriptor");
  return { v, meter, registry, keywords, meta, descriptor };
}

it("validates explicit metaclass receivers before keyword names", () => {
  const { v, meter, registry, keywords, descriptor } = fixture();
  keywords.items.set(v.integer(1), v.none);
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("descriptor '__prepare__' of 'type' object needs an argument");
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.none], keywords, meter)).toThrow("descriptor '__prepare__' for type 'type' needs a type, not a 'NoneType' as arg 2");
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.object], keywords, meter)).toThrow("descriptor '__prepare__' requires a subtype of 'type' but received 'object'");
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.type], keywords, meter)).toThrow("keywords must be strings");
});

it("ignores arbitrary class arguments without mutating inputs or sharing dictionaries", () => {
  const { v, meter, registry, keywords, descriptor, meta } = fixture();
  keywords.items.set(v.string("unexpected"), v.true);
  for (const receiver of [registry.type, meta]) {
    const first = callRuntimeMethodDescriptor(descriptor, [receiver, v.none, v.integer(3)], keywords, meter);
    const second = callRuntimeMethodDescriptor(descriptor, [receiver], keywords, meter);
    if (first.kind !== "dict" || second.kind !== "dict") throw Error("expected namespaces");
    expect(first).not.toBe(second); expect(first.items.size).toBe(0);
    first.items.set(v.string("field"), v.integer(7)); expect(second.items.size).toBe(0);
  }
  expect(keywords.items.size).toBe(1); expect(keywords.items.lookup(v.string("unexpected"))?.value).toBe(v.true);
});

it("binds inherited hooks to the selected metaclass and rejects ordinary classes", () => {
  const { v, meter, registry, descriptor, meta } = fixture();
  const bound = getRuntimeMethodDescriptor(descriptor, v.none, meta, v, meter);
  expect(bound.kind).toBe("builtin_function_or_method");
  if (bound.kind === "builtin_function_or_method") expect(bound.binding?.instance).toBe(meta);
  expect(() => getRuntimeMethodDescriptor(descriptor, v.none, registry.object, v, meter)).toThrow("requires a subtype of 'type'");
});

it("does not allocate a namespace after cancellation", () => {
  const controller = new AbortController(), { meter, registry, keywords, descriptor } = fixture(controller.signal);
  controller.abort();
  expect(() => descriptor.value.invoke(registry.type, [], keywords, meter)).toThrow("execution cancelled");
});
