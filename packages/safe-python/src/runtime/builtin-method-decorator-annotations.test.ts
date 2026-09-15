import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { readRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture(name: string, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter), registry = new RuntimeTypeRegistry(v, { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, meter), type = registry.methodDecoratorType("staticmethod"), wrapper = v.methodDecorator("staticmethod", v.true, type);
  const descriptor = type.value.namespace.items.lookup(v.string(name))!.value;
  if (descriptor.kind !== "getset_descriptor") throw Error("expected annotation getset");
  return { meter, v, type, wrapper, descriptor };
}

it.each(["__annotations__", "__annotate__"])("caches %s by identity including None and overwrites nested successful cache writes", name => {
  const { meter, v, type, wrapper, descriptor } = fixture(name);
  expect(readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, {
    call() { throw Error("unused"); }, isStopIteration: () => false,
    attribute(value, key) { expect(value).toBe(v.true); expect(key).toBe(name); wrapper.state.attributes.set(name, v.true); return v.none; }
  })).toBe(v.none);
  expect(wrapper.state.attributes.get(name)).toBe(v.none);
  expect(readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter)).toBe(v.none);
});

it.each(["__annotations__", "__annotate__"])("propagates %s lookup failures while preserving nested side effects", name => {
  const { meter, v, type, wrapper, descriptor } = fixture(name), error = new PythonRuntimeError("ValueError", "lookup failed");
  expect(() => readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, {
    call() { throw Error("unused"); }, isStopIteration: () => false,
    attribute() { wrapper.state.attributes.set(name, v.false); throw error; }
  })).toThrow(error);
  expect(readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter)).toBe(v.false);
});

it("does not cache a value after lookup cancels the execution", () => {
  const controller = new AbortController(), { meter, v, type, wrapper, descriptor } = fixture("__annotations__", controller.signal);
  expect(() => readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, {
    call() { throw Error("unused"); }, isStopIteration: () => false,
    attribute() { controller.abort(); return v.true; }
  })).toThrow(ExecutionLimitError);
  expect(wrapper.state.attributes.size).toBe(0);
});
