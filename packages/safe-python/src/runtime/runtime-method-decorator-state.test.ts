import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues } from "./runtime-values.js";
import { getRuntimeMethodDecorator } from "./runtime-method-decorator.js";

it.each(["staticmethod", "classmethod"] as const)("reinitializes %s without replacing its identity or previously bound methods", kind => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter);
  const wrapper = v.methodDecorator(kind, v.true), owner = v.integer(2);
  const before = getRuntimeMethodDecorator(wrapper, null, owner, v, meter), names: string[] = [];
  wrapper.state.initialize(v.false, (_value, name) => { names.push(name); return v.string(name); }, meter);
  expect(Object.isFrozen(wrapper)).toBe(true);
  expect(wrapper.value).toBe(v.false);
  expect(names).toEqual(["__module__", "__name__", "__qualname__", "__doc__"]);
  expect(wrapper.state.attributes.size).toBe(4);
  expect(before.kind === "method" ? before.value.function : before).toBe(v.true);
  const after = getRuntimeMethodDecorator(wrapper, null, owner, v, meter);
  expect(after.kind === "method" ? after.value.function : after).toBe(v.false);
});

it("retains missing metadata and partial changes when metadata lookup fails", () => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter), wrapper = v.methodDecorator("staticmethod", v.true);
  wrapper.state.initialize(v.true, () => v.true, meter);
  const error = new PythonRuntimeError("ValueError", "bad");
  expect(() => wrapper.state.initialize(v.false, (_value, name) => {
    if (name === "__module__") return v.false;
    if (name === "__name__") throw new PythonRuntimeError("AttributeError", "missing");
    throw error;
  }, meter)).toThrow(error);
  expect(wrapper.value).toBe(v.false);
  expect(wrapper.state.attributes.get("__module__")).toBe(v.false);
  expect(wrapper.state.attributes.get("__name__")).toBe(v.true);
  expect(wrapper.state.attributes.get("__doc__")).toBe(v.true);
});

it("keeps the nested initializer's payload while completing outer metadata copying", () => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter), wrapper = v.methodDecorator("classmethod", v.true);
  wrapper.state.initialize(v.false, (value, name) => {
    expect(value).toBe(v.false);
    if (name === "__module__") wrapper.state.initialize(v.none, () => v.none, meter);
    return v.false;
  }, meter);
  expect(wrapper.value).toBe(v.none);
  expect([...wrapper.state.attributes.values()]).toEqual([v.false, v.false, v.false, v.false]);
});

it.each([false, true])("observes cancellation after metadata callbacks (throws: %s)", throws => {
  const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal }), v = new RuntimeValues(meter), wrapper = v.methodDecorator("staticmethod", v.true);
  expect(() => wrapper.state.initialize(v.false, () => {
    controller.abort();
    if (throws) throw new PythonRuntimeError("AttributeError", "missing");
    return v.true;
  }, meter)).toThrow(ExecutionLimitError);
  expect(wrapper.value).toBe(v.false);
  expect(wrapper.state.attributes.size).toBe(0);
});

it("propagates host failures unchanged and does not mistake their names for guest exceptions", () => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter), wrapper = v.methodDecorator("classmethod", v.true), error = new Error("host failure");
  error.name = "AttributeError";
  expect(() => wrapper.state.initialize(v.false, () => { throw error; }, meter)).toThrow(error);
  expect(wrapper.value).toBe(v.false);
  expect(wrapper.state.attributes.size).toBe(0);
});
