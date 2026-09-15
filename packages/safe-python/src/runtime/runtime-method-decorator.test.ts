import { expect, it } from "vitest";
import { getRuntimeMethodDecorator } from "./runtime-method-decorator.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { meter, v };
}

it.each(["staticmethod", "classmethod"] as const)("rejects the double-None descriptor marker for %s", kind => {
  const { meter, v } = fixture(), descriptor = v.methodDecorator(kind, v.none);
  expect(() => getRuntimeMethodDecorator(descriptor, null, v.none, v, meter)).toThrow("__get__(None, None) is invalid");
  expect(() => getRuntimeMethodDecorator(descriptor, v.none, v.none, v, meter)).toThrow("__get__(None, None) is invalid");
});

it("returns static payloads unchanged without binding or classifying them", () => {
  const { meter, v } = fixture(), payload = v.cell({}), descriptor = v.methodDecorator("staticmethod", payload);
  for (const instance of [null, v.true]) expect(getRuntimeMethodDecorator(descriptor, instance, v.integer(7), v, meter, () => { throw Error("must not classify"); })).toBe(payload);
});

it("binds classmethod payloads to explicit owners even when they are not types", () => {
  const { meter, v } = fixture(), payload = v.none, owner = v.list([]), descriptor = v.methodDecorator("classmethod", payload);
  const method = getRuntimeMethodDecorator(descriptor, v.true, owner, v, meter);
  if (method.kind !== "method") throw Error("expected method");
  expect(method.value.function).toBe(payload); expect(method.value.instance).toBe(owner);
});

it("uses actual receiver type policy only when a classmethod owner is omitted", () => {
  const { meter, v } = fixture(), descriptor = v.methodDecorator("classmethod", v.true), registry = new RuntimeTypeRegistry(v, { hash: () => 1n, equal: (a, b) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, meter), owner = registry.object;
  const method = getRuntimeMethodDecorator(descriptor, v.false, v.none, v, meter, value => { expect(value).toBe(v.false); return owner; });
  if (method.kind !== "method") throw Error("expected method"); expect(method.value.instance).toBe(owner);
});

it("uses intrinsic instance/type ownership without invoking external classification", () => {
  const { meter, v } = fixture(), registry = new RuntimeTypeRegistry(v, { hash: () => 1n, equal: (a, b) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, meter), wrapper = v.methodDecorator("classmethod", v.true);
  for (const [instance, owner] of [[v.instance(registry.object), registry.object], [registry.object, registry.type]] as const) {
    const method = getRuntimeMethodDecorator(wrapper, instance, v.none, v, meter, () => { throw Error("must not classify intrinsic owners"); });
    if (method.kind !== "method") throw Error("expected bound method"); expect(method.value.instance).toBe(owner);
  }
});

it.each(["staticmethod", "classmethod"] as const)("provides intrinsic non-data descriptor slots for %s", kind => {
  const { meter, v } = fixture(), descriptor = v.methodDecorator(kind, v.true);
  const resolved = resolveRuntimeClassAttribute(descriptor, { slots() { throw Error("must not use external descriptor policy"); } }, v, meter);
  expect(resolved.slots?.get).toBeTypeOf("function"); expect(resolved.slots?.set).toBeUndefined(); expect(resolved.slots?.delete).toBeUndefined();
});

it("does not chain classmethod descriptor binding into its wrapped value", () => {
  const { meter, v } = fixture(), inner = v.methodDecorator("staticmethod", v.true), outer = v.methodDecorator("classmethod", inner);
  const result = getRuntimeMethodDecorator(outer, null, v.integer(1), v, meter);
  if (result.kind !== "method") throw Error("expected method"); expect(result.value.function).toBe(inner);
});

it.each(["staticmethod", "classmethod"] as const)("keeps exact %s truth, hash and callability independent of the payload", kind => {
  const { meter, v } = fixture(), descriptor = v.methodDecorator(kind, v.none);
  expect(runtimeTruth(descriptor, meter)).toBe(true);
  expect(runtimeCallable(descriptor, meter, { callable() { throw Error("must use intrinsic callability"); } })).toBe(kind === "staticmethod");
  expect(runtimeHash(descriptor, { none: v.none, identity: () => 17n, string: () => 0n, bytes: () => 0n }, meter)).toBe(17n);
});
