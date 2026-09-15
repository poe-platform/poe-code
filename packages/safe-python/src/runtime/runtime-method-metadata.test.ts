import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), instance = v.list([]);
  const invoke = () => { throw Error("metadata must not invoke a method"); };
  const descriptor = v.methodDescriptor({ owner: registry.object, name: "méthod", accepts: () => true, invoke });
  const bound = getRuntimeMethodDescriptor(descriptor, instance, v.none, v, meter);
  const read = (value: RuntimeValue, name: string) => runtimeNativeAttribute(value, name, v, meter);
  return { v, meter, registry, instance, invoke, descriptor, bound, read };
}

it("exposes the native method descriptor name and defining owner", () => {
  const { v, registry, descriptor, read } = fixture();
  expect(read(descriptor, "__name__")).toEqual(v.string("méthod"));
  expect(read(descriptor, "__objclass__")).toBe(registry.object);
});

it("exposes native getset names and owners without invoking the getter", () => {
  const { v, registry, read } = fixture();
  const descriptor = v.getsetDescriptor({ owner: registry.object, name: "value", accepts: () => true, get() { throw Error("must not get"); } });
  expect(read(descriptor, "__name__")).toEqual(v.string("value"));
  expect(read(descriptor, "__objclass__")).toBe(registry.object);
});

it("exposes the bound receiver and unqualified native method name", () => {
  const { v, instance, bound, read } = fixture();
  expect(read(bound, "__self__")).toBe(instance);
  expect(read(bound, "__name__")).toEqual(v.string("méthod"));
});

it("retains the accessed alias name rather than the canonical implementation name", () => {
  const { v, meter, registry, instance, invoke, read } = fixture();
  const alias = v.methodDescriptor({ owner: registry.object, name: "alias", accepts: () => true, invoke });
  const bound = getRuntimeMethodDescriptor(alias, instance, v.none, v, meter);
  expect(read(bound, "__name__")).toEqual(v.string("alias"));
});

it.each(["value", "binding", "invoke", "implementation", "descriptor"])("never exposes host capability field %s", name => {
  const { descriptor, bound, read } = fixture();
  expect(() => read(descriptor, name)).toThrow("has no attribute");
  expect(() => read(bound, name)).toThrow("has no attribute");
});

it("keeps descriptor owner and bound receiver metadata on their proper families", () => {
  const { descriptor, bound, read } = fixture();
  expect(() => read(descriptor, "__self__")).toThrow("'method_descriptor' object has no attribute '__self__'");
  expect(() => read(bound, "__objclass__")).toThrow("'builtin_function_or_method' object has no attribute '__objclass__'");
});

it("observes cancellation before exposing metadata", () => {
  const controller = new AbortController(), { bound, read } = fixture(controller.signal);
  controller.abort(); expect(() => read(bound, "__self__")).toThrow("execution cancelled");
});
