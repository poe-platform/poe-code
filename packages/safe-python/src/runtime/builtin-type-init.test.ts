import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor, getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = dictionary();
  const initializer = registry.type.value.namespace.items.lookup(v.string("__init__"))?.value;
  if (initializer?.kind !== "wrapper_descriptor") throw Error("expected type initializer wrapper");
  const meta = registry.publish(new RuntimeTypeLayout("Meta", [registry.type.value], dictionary(), meter), registry.type);
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), meta);
  const call = (...args: RuntimeValue[]) => callRuntimeMethodDescriptor(initializer, args, keywords, meter);
  return { v, meter, registry, initializer, cls, meta, keywords, call };
}

it.each([0, 1, 2, 3, 4])("validates type initializer positional count %s", count => {
  const { v, cls, call } = fixture(), args = Array.from({ length: count }, () => v.none);
  if (count === 1 || count === 3) expect(call(cls, ...args)).toBe(v.none);
  else expect(() => call(cls, ...args)).toThrow("type.__init__() takes 1 or 3 arguments");
});

it.each([0, 1, 2, 3, 4])("validates keyword handling after positional count %s", count => {
  const { v, cls, keywords, call } = fixture(), args = Array.from({ length: count }, () => v.none);
  keywords.items.set(v.string("arbitrary"), v.true);
  if (count === 3) expect(call(cls, ...args)).toBe(v.none);
  else expect(() => call(cls, ...args)).toThrow(count === 1 ? "type.__init__() takes no keyword arguments" : "type.__init__() takes 1 or 3 arguments");
});

it("does not rebuild or mutate a class from three initializer arguments", () => {
  const { v, cls, call } = fixture(), layout = cls.value;
  expect(call(cls, v.integer(1), v.false, v.none)).toBe(v.none);
  expect(cls.value).toBe(layout); expect(cls.value.name).toBe("C"); expect(cls.value.namespace.items.size).toBe(0);
});

it("validates actual metaclass applicability and binds subclass receivers", () => {
  const { v, meter, registry, initializer, cls, meta, keywords, call } = fixture();
  expect(() => call(v.instance(cls), v.none)).toThrow("descriptor '__init__' requires a 'type' object but received a 'C'");
  for (const receiver of [registry.object, registry.type, meta, cls]) {
    const bound = getRuntimeMethodDescriptor(initializer, receiver, v.none, v, meter);
    if (bound.kind !== "method-wrapper") throw Error("expected bound wrapper");
    expect(callRuntimeMethodDescriptor(bound, [v.none], keywords, meter)).toBe(v.none);
  }
});

it("observes cancellation before type initialization", () => {
  const controller = new AbortController(), { v, cls, call } = fixture(controller.signal);
  controller.abort(); expect(() => call(cls, v.none)).toThrow("execution cancelled");
});
