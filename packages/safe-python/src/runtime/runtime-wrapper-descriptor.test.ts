import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeHash } from "./runtime-hash.js";
import { getRuntimeMethodDescriptor, callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), receiver = v.list([]), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const descriptor = v.wrapperDescriptor({ owner: registry.object, name: "slot", accepts: value => value.kind === "list", invoke: () => v.true });
  const bind = (instance: RuntimeValue = receiver) => getRuntimeMethodDescriptor(descriptor, instance, v.none, v, meter);
  return { meter, v, registry, receiver, descriptor, keywords, bind };
}

it("retains distinct wrapper descriptor and bound method-wrapper families", () => {
  const { v, meter, descriptor, bind } = fixture(), bound = bind();
  expect(descriptor.kind).toBe("wrapper_descriptor"); expect(bound.kind).toBe("method-wrapper");
  expect(getRuntimeMethodDescriptor(descriptor, null, v.true, v, meter)).toBe(descriptor);
  expect(runtimeCallable(descriptor, meter)).toBe(true); expect(runtimeCallable(bound, meter)).toBe(true);
  expect(runtimeTruth(descriptor, meter)).toBe(true); expect(runtimeTruth(bound, meter)).toBe(true);
});

it("uses wrapper-specific diagnostics for unbound calls", () => {
  const { v, meter, descriptor, keywords, receiver } = fixture();
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("descriptor 'slot' of 'object' object needs an argument");
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.integer(1)], keywords, meter)).toThrow("descriptor 'slot' requires a 'object' object but received a 'int'");
  expect(callRuntimeMethodDescriptor(descriptor, [receiver], keywords, meter)).toBe(v.true);
});

it("validates receiver applicability during binding and retains non-data slots", () => {
  const { v, meter, descriptor, bind, receiver } = fixture();
  expect(() => bind(v.integer(1))).toThrow("descriptor 'slot' for 'object' objects doesn't apply to a 'int' object");
  const attribute = resolveRuntimeClassAttribute(descriptor, { slots() { throw Error("intrinsic slot expected"); } }, v, meter);
  expect(attribute.slots?.get?.(receiver, v.none).kind).toBe("method-wrapper");
  expect(attribute.slots?.set).toBeUndefined(); expect(attribute.slots?.delete).toBeUndefined();
});

it("compares wrappers by descriptor and receiver identity without invoking guest equality", () => {
  const { v, meter, descriptor, receiver, bind } = fixture(), a = bind(), b = bind();
  expect(a === b).toBe(false); expect(runtimeComparison("==", a, b, v, meter)).toBe(v.true);
  expect(runtimeComparison("!=", a, b, v, meter)).toBe(v.false);
  expect(runtimeComparison("==", a, bind(v.list([])), v, meter)).toBe(v.false);
  const alias = v.wrapperDescriptor(descriptor.value);
  expect(runtimeComparison("==", a, getRuntimeMethodDescriptor(alias, receiver, v.none, v, meter), v, meter)).toBe(v.false);
});

it("hashes equal wrappers consistently using receiver and descriptor identities", () => {
  const { v, meter, receiver, bind } = fixture();
  const context = { none: v.none, identity: (value: RuntimeValue) => value === receiver ? 17n : 23n, string: () => 1n, bytes: () => 1n };
  expect(runtimeHash(bind(), context, meter)).toBe(17n ^ 23n); expect(runtimeHash(bind(), context, meter)).toBe(17n ^ 23n);
});

it("exposes method-wrapper receiver, name and defining owner metadata", () => {
  const { v, meter, descriptor, bind, receiver, registry } = fixture(), bound = bind();
  expect(runtimeNativeAttribute(bound, "__self__", v, meter)).toBe(receiver);
  expect(runtimeNativeAttribute(bound, "__name__", v, meter)).toEqual(v.string("slot"));
  expect(runtimeNativeAttribute(bound, "__objclass__", v, meter)).toBe(registry.object);
  expect(runtimeNativeAttribute(descriptor, "__objclass__", v, meter)).toBe(registry.object);
});

it("forwards bound arguments and keywords without adding a second receiver", () => {
  const { v, meter, registry, receiver, keywords } = fixture();
  const descriptor = v.wrapperDescriptor({ owner: registry.object, name: "slot", accepts: () => true, invoke(instance, args, named) { expect(instance).toBe(receiver); expect(args).toEqual([v.false]); expect(named).toBe(keywords); return v.true; } });
  const bound = getRuntimeMethodDescriptor(descriptor, receiver, v.none, v, meter);
  if (bound.kind !== "method-wrapper") throw Error("expected wrapper");
  expect(callRuntimeMethodDescriptor(bound, [v.false], keywords, meter)).toBe(v.true);
  expect(Object.isFrozen(bound.value)).toBe(true);
});

it.each([false, true])("checks cancellation after wrapper invocation, bound=%s", bound => {
  const controller = new AbortController(), { v, meter, registry, receiver, keywords } = fixture(controller.signal);
  const descriptor = v.wrapperDescriptor({ owner: registry.object, name: "slot", accepts: () => true, invoke() { controller.abort(); return v.none; } });
  const callee = bound ? getRuntimeMethodDescriptor(descriptor, receiver, v.none, v, meter) : descriptor;
  if (callee.kind !== "method-wrapper" && callee.kind !== "wrapper_descriptor") throw Error("expected wrapper");
  expect(() => callRuntimeMethodDescriptor(callee, bound ? [] : [receiver], keywords, meter)).toThrow("execution cancelled");
});

it("checks cancellation after wrapper receiver validation", () => {
  const controller = new AbortController(), { v, meter, registry, receiver } = fixture(controller.signal);
  const descriptor = v.wrapperDescriptor({ owner: registry.object, name: "slot", accepts() { controller.abort(); return true; }, invoke() { throw Error("must not call"); } });
  expect(() => getRuntimeMethodDescriptor(descriptor, receiver, v.none, v, meter)).toThrow("execution cancelled");
});
