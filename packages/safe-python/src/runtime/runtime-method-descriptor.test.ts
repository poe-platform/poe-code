import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { callRuntimeMethodDescriptor, getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const calls: RuntimeValue[][] = [];
  const descriptor = v.methodDescriptor({ owner: registry.object, name: "method", accepts: value => value.kind === "list", invoke(receiver, args, named) { expect(named).toBe(keywords); calls.push([receiver, ...args]); return v.true; } });
  return { meter, v, registry, keywords, descriptor, calls };
}

it("returns the descriptor on class access and rejects an empty get", () => {
  const { descriptor, v, meter } = fixture();
  expect(getRuntimeMethodDescriptor(descriptor, null, v.true, v, meter)).toBe(descriptor);
  expect(getRuntimeMethodDescriptor(descriptor, v.none, v.true, v, meter)).toBe(descriptor);
  expect(() => getRuntimeMethodDescriptor(descriptor, v.none, v.none, v, meter)).toThrow("__get__(None, None) is invalid");
});

it("binds without calling and forwards receiver, arguments and keywords", () => {
  const { descriptor, v, meter, keywords, calls } = fixture(), receiver = v.list([]);
  const bound = getRuntimeMethodDescriptor(descriptor, receiver, v.none, v, meter);
  expect(calls).toEqual([]);
  if (bound.kind !== "builtin_function_or_method") throw Error("expected native bound method");
  expect(bound.value.invoke([v.false], keywords, meter)).toBe(v.true);
  expect(calls).toEqual([[receiver, v.false]]);
});

it("validates unbound receivers before invoking the native implementation", () => {
  const { descriptor, v, meter, keywords, calls } = fixture(), receiver = v.list([]);
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("unbound method object.method() needs an argument");
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.integer(1)], keywords, meter)).toThrow("descriptor 'method' for 'object' objects doesn't apply to a 'int' object");
  expect(calls).toEqual([]);
  expect(callRuntimeMethodDescriptor(descriptor, [receiver, v.false], keywords, meter)).toBe(v.true);
  expect(calls).toEqual([[receiver, v.false]]);
});

it("uses intrinsic non-data descriptor slots", () => {
  const { descriptor, v, meter } = fixture();
  const attribute = resolveRuntimeClassAttribute(descriptor, { slots() { throw Error("must not query external slots"); } }, v, meter);
  expect(attribute.slots?.get?.(v.list([]), v.none).kind).toBe("builtin_function_or_method");
  expect(attribute.slots?.set).toBeUndefined(); expect(attribute.slots?.delete).toBeUndefined();
});

it("checks cancellation after receiver validation", () => {
  const controller = new AbortController(), { v, meter, registry } = fixture(controller.signal);
  const descriptor = v.methodDescriptor({ owner: registry.object, name: "method", accepts() { controller.abort(); return true; }, invoke() { throw Error("must not invoke"); } });
  expect(() => getRuntimeMethodDescriptor(descriptor, v.true, v.none, v, meter)).toThrow("execution cancelled");
});

it("classifies native descriptors as callable, truthy identity-hashed values", () => {
  const { descriptor, meter, v } = fixture();
  expect(runtimeCallable(descriptor, meter)).toBe(true);
  expect(runtimeTruth(descriptor, meter)).toBe(true);
  expect(runtimeHash(descriptor, { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, meter)).toBe(17n);
});

it.each([false, true])("checks cancellation after native invocation, bound=%s", bound => {
  const controller = new AbortController(), { v, meter, registry, keywords } = fixture(controller.signal);
  let called = false;
  const descriptor = v.methodDescriptor({ owner: registry.object, name: "method", accepts: () => true, invoke() { called = true; controller.abort(); return v.none; } });
  const receiver = v.list([]);
  if (bound) {
    const method = getRuntimeMethodDescriptor(descriptor, receiver, v.none, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected bound method");
    expect(() => method.value.invoke([], keywords, meter)).toThrow("execution cancelled");
  } else expect(() => callRuntimeMethodDescriptor(descriptor, [receiver], keywords, meter)).toThrow("execution cancelled");
  expect(called).toBe(true);
});

it("rejects invalid receivers during binding", () => {
  const { descriptor, v, meter, calls } = fixture();
  expect(() => getRuntimeMethodDescriptor(descriptor, v.integer(1), v.none, v, meter)).toThrow("descriptor 'method' for 'object' objects doesn't apply to a 'int' object");
  expect(calls).toEqual([]);
});

it("bounds receiver type diagnostics to 100 UTF-8 bytes", () => {
  const { descriptor, v, meter, registry, keywords } = fixture();
  const owner = registry.publish(new RuntimeTypeLayout("é".repeat(100), [registry.object.value], keywords, meter), registry.type);
  expect(() => getRuntimeMethodDescriptor(descriptor, v.instance(owner), v.none, v, meter)).toThrow(`descriptor 'method' for 'object' objects doesn't apply to a '${"é".repeat(50)}' object`);
});
