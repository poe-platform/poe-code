import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { readRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const registry = new RuntimeTypeRegistry(v, { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, meter), type = registry.methodDecoratorType("staticmethod");
  const descriptor = type.value.namespace.items.lookup(v.string("__isabstractmethod__"))!.value;
  if (descriptor.kind !== "getset_descriptor") throw Error("expected abstractness getset");
  return { meter, v, type, descriptor };
}

it("treats only native missing-attribute errors as a false abstractness flag", () => {
  const { meter, v, type, descriptor } = fixture(), wrapper = v.methodDecorator("staticmethod", v.true, type);
  for (const error of [new PythonRuntimeError("AttributeError", "missing"), new PythonRuntimeError("ValueError", "bad"), Object.assign(new Error("host"), { name: "AttributeError" })]) {
    const read = () => readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, {
      call() { throw Error("unused"); }, isStopIteration: () => false,
      attribute() { throw error; }, truth() { throw Error("must not convert absent attribute"); }
    });
    if (error instanceof PythonRuntimeError && error.name === "AttributeError") expect(read()).toBe(v.false);
    else expect(read).toThrow(error);
  }
});

it.each(["attribute", "truth"] as const)("observes cancellation after abstractness %s callbacks", stage => {
  const controller = new AbortController(), { meter, v, type, descriptor } = fixture(controller.signal), wrapper = v.methodDecorator("staticmethod", v.true, type);
  expect(() => readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, {
    call() { throw Error("unused"); }, isStopIteration: () => false,
    attribute() { if (stage === "attribute") { controller.abort(); throw new PythonRuntimeError("AttributeError", "missing"); } return v.true; },
    truth() { controller.abort(); return true; }
  })).toThrow(ExecutionLimitError);
});

it("reads None-backed wrapper abstractness without invoking external policies", () => {
  const { meter, v, type, descriptor } = fixture();
  expect(readRuntimeGetsetDescriptor(descriptor, v.methodDecorator("staticmethod", v.none, type), type, meter)).toBe(v.false);
});

it("requires a truth policy only after finding an abstractness flag", () => {
  const { meter, v, type, descriptor } = fixture(), wrapper = v.methodDecorator("staticmethod", v.true, type);
  const invocation = { call() { throw Error("unused"); }, isStopIteration: () => false, attribute(): RuntimeValue { throw new PythonRuntimeError("AttributeError", "missing"); } };
  expect(readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, invocation)).toBe(v.false);
  expect(() => readRuntimeGetsetDescriptor(descriptor, wrapper, type, meter, { ...invocation, attribute: () => v.true })).toThrow("method-wrapper abstractness requires a truth policy");
});
