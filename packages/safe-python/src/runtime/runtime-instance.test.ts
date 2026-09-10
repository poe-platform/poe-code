import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeActualType } from "./runtime-special-method.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeHash } from "./runtime-hash.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), type = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), registry.type);
  return { meter, v, dictionary, registry, type };
}

it("publishes distinct immutable instance records without invoking constructors", () => {
  const { v, type } = fixture();
  type.value.namespace.items.set(v.string("__new__"), v.builtinFunction({ name: "new", invoke(): never { throw Error("must not invoke allocator"); } }));
  const first = v.instance(type), second = v.instance(type);
  expect(first.type).toBe(type); expect(first.dictionary).toBeUndefined(); expect(first === second).toBe(false);
  expect(Object.isFrozen(first)).toBe(true);
});

it("adopts owned dictionaries without copying shared members or cycles", () => {
  const { v, type, dictionary } = fixture(), attributes = dictionary(), instance = v.instance(type, attributes), member = v.list([]);
  attributes.items.set(v.string("self"), instance); attributes.items.set(v.string("member"), member);
  expect(instance.dictionary).toBe(attributes); expect(instance.dictionary!.items.lookup(v.string("self"))!.value).toBe(instance);
  member.items.append(instance); expect(instance.dictionary!.items.lookup(v.string("member"))!.value).toBe(member);
});

it("uses intrinsic ownership rather than shadow __class__ attributes or external policy", () => {
  const { v, meter, type, registry, dictionary } = fixture(), attributes = dictionary(), instance = v.instance(type, attributes);
  attributes.items.set(v.string("__class__"), registry.object);
  const unused = (): never => { throw Error("must not query external ownership"); };
  const context = { typeOf: unused, slots: unused };
  expect(runtimeActualType(instance, context, meter)).toBe(type);
  expect(runtimeActualType(type, context, meter)).toBe(registry.type);
  expect(runtimeActualType(registry.type, context, meter)).toBe(registry.type);
});

it("retains external classification for opaque values and observes cancellation", () => {
  const { v, type } = fixture(), controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal });
  const value = v.cell({});
  expect(() => runtimeActualType(value, { typeOf(actual) { expect(actual).toBe(value); controller.abort(); return type; }, slots: () => undefined }, meter)).toThrow("execution cancelled");
});

it("keeps native fallback truthy and declines unsupported native arithmetic", () => {
  const { v, meter, type } = fixture(), instance = v.instance(type);
  expect(runtimeTruth(instance, meter)).toBe(true);
  expect(runtimeBinary("-", instance, v.integer(1), v, meter)).toBe(v.notImplemented);
  expect(runtimeComparison("==", instance, instance, v, meter)).toBe(v.true);
  expect(runtimeComparison("==", instance, v.instance(type), v, meter)).toBe(v.false);
});

it("meters instance wrapping before publication", () => {
  const { type } = fixture(), meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 160 }), v = new RuntimeValues(meter);
  expect(() => v.instance(type)).toThrow(ExecutionLimitError);
});

it("routes default instance hashes through the execution identity policy", () => {
  const { v, meter, type } = fixture(), instance = v.instance(type); let calls = 0;
  const context = { none: v.none, identity(value: RuntimeValue) { expect(value).toBe(instance); calls++; return 17n; }, string(): never { throw Error("not a string"); }, bytes(): never { throw Error("not bytes"); } };
  expect(runtimeHash(instance, context, meter)).toBe(17n);
  expect(runtimeHash(instance, context, meter)).toBe(17n); expect(calls).toBe(2);
});
