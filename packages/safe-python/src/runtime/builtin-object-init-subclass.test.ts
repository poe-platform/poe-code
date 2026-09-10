import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor, getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], v.dictionary(keywords.items.emptyCopy()), meter), registry.type);
  const descriptor = registry.object.value.namespace.items.lookup(v.string("__init_subclass__"))!.value;
  if (descriptor.kind !== "classmethod_descriptor") throw Error("expected native class-method descriptor");
  return { v, meter, registry, cls, descriptor, keywords };
}

it("validates direct class receivers before checking the hook's arguments", () => {
  const { v, meter, descriptor, keywords, cls } = fixture();
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("descriptor '__init_subclass__' of 'object' object needs an argument");
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.none, v.true], keywords, meter)).toThrow("descriptor '__init_subclass__' for type 'object' needs a type, not a 'NoneType' as arg 2");
  expect(callRuntimeMethodDescriptor(descriptor, [cls], keywords, meter)).toBe(v.none);
  keywords.items.set(v.string("flag"), v.true);
  expect(() => callRuntimeMethodDescriptor(descriptor, [cls, v.true], keywords, meter)).toThrow("C.__init_subclass__() takes no keyword arguments");
});

it("uses the supplied class owner without inspecting the instance", () => {
  const { v, meter, descriptor, cls, keywords } = fixture();
  const bound = getRuntimeMethodDescriptor(descriptor, v.integer(1), cls, v, meter, () => { throw Error("must not classify ignored instance"); });
  if (bound.kind !== "builtin_function_or_method") throw Error("expected native bound method");
  expect(bound.binding?.instance).toBe(cls); expect(bound.value.invoke([], keywords, meter)).toBe(v.none);
  expect(() => getRuntimeMethodDescriptor(descriptor, v.none, v.integer(1), v, meter)).toThrow("needs a type, not a 'int' as arg 2");
  expect(() => getRuntimeMethodDescriptor(descriptor, null, v.none, v, meter)).toThrow("__get__(None, None) is invalid");
});

it("derives omitted owners from actual instance and metaclass identities", () => {
  const { v, meter, registry, descriptor, cls } = fixture();
  for (const [instance, expected] of [[v.instance(cls), cls], [cls, registry.type]] as const) {
    const bound = getRuntimeMethodDescriptor(descriptor, instance, v.none, v, meter);
    if (bound.kind !== "builtin_function_or_method") throw Error("expected native bound method");
    expect(bound.binding?.instance).toBe(expected);
  }
  const opaque = v.cell({}); let calls = 0;
  const bound = getRuntimeMethodDescriptor(descriptor, opaque, v.none, v, meter, value => { calls++; expect(value).toBe(opaque); return cls; });
  if (bound.kind !== "builtin_function_or_method") throw Error("expected native bound method");
  expect(bound.binding?.instance).toBe(cls); expect(calls).toBe(1);
  const noneOwner = registry.noneType();
  const noneBound = getRuntimeMethodDescriptor(descriptor, v.none, v.none, v, meter, value => { expect(value).toBe(v.none); return noneOwner; });
  if (noneBound.kind !== "builtin_function_or_method") throw Error("expected native bound method");
  expect(noneBound.binding?.instance).toBe(noneOwner);
});

it("preserves intrinsic binding, callability, truth and native binding identity", () => {
  const { v, meter, descriptor, cls } = fixture();
  const attribute = resolveRuntimeClassAttribute(descriptor, { slots() { throw Error("must not ask for guest slots"); } }, v, meter);
  const first = attribute.slots!.get!(null, cls), second = attribute.slots!.get!(v.instance(cls), cls);
  expect(runtimeCallable(descriptor, meter)).toBe(true); expect(runtimeTruth(descriptor, meter)).toBe(true);
  expect(runtimeComparison("==", first, second, v, meter)).toBe(v.true);
  const identities = new Map<RuntimeValue, bigint>();
  const hashes = { none: v.none, string: () => 0n, bytes: () => 0n, identity(value: RuntimeValue) { if (!identities.has(value)) identities.set(value, BigInt(identities.size + 1)); return identities.get(value)!; } };
  expect(runtimeHash(first, hashes, meter)).toBe(runtimeHash(second, hashes, meter));
  expect(runtimeHash(descriptor, hashes, meter)).toBe(hashes.identity(descriptor));
});

it("rejects incompatible class owners before invoking host capabilities", () => {
  const { v, meter, registry, cls, keywords } = fixture();
  const descriptor = v.classMethodDescriptor({ owner: cls, name: "method", accepts: value => value === cls, invoke() { throw Error("must not call rejected receiver"); } });
  expect(() => getRuntimeMethodDescriptor(descriptor, null, registry.object, v, meter)).toThrow("descriptor 'method' requires a subtype of 'C' but received 'object'");
  expect(() => callRuntimeMethodDescriptor(descriptor, [registry.object], keywords, meter)).toThrow("descriptor 'method' requires a subtype of 'C' but received 'object'");
});

it("checks cancellation after owner classification", () => {
  const controller = new AbortController(), { v, meter, descriptor, cls } = fixture(controller.signal);
  expect(() => getRuntimeMethodDescriptor(descriptor, v.cell({}), v.none, v, meter, () => { controller.abort(); return cls; })).toThrow("execution cancelled");
});
