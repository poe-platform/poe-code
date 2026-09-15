import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeCallable } from "./runtime-callability.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, registry = new RuntimeTypeRegistry(v, keys, meter);
  return { meter, v, registry };
}

it.each(["staticmethod", "classmethod"] as const)("publishes live readonly member descriptors on %s", kind => {
  const { meter, v, registry } = fixture(), type = registry.methodDecoratorType(kind), wrapper = v.methodDecorator(kind, v.true, type);
  for (const name of ["__func__", "__wrapped__"]) {
    const member = type.value.namespace.items.lookup(v.string(name))?.value;
    if (member?.kind !== "member_descriptor") throw Error("expected native member descriptor");
    expect(readRuntimeGetsetDescriptor(member, null, type, meter)).toBe(member);
    expect(readRuntimeGetsetDescriptor(member, wrapper, type, meter)).toBe(v.true);
    expect(runtimeNativeAttribute(member, "__name__", v, meter)).toEqual(v.string(name));
    expect(runtimeNativeAttribute(member, "__objclass__", v, meter)).toBe(type);
    expect(() => mutateRuntimeGetsetDescriptor(member, wrapper, { kind: "set", value: v.false }, meter)).toThrow("readonly attribute");
    expect(() => mutateRuntimeGetsetDescriptor(member, wrapper, { kind: "delete" }, meter)).toThrow("readonly attribute");
    expect(() => mutateRuntimeGetsetDescriptor(member, v.none, { kind: "delete" }, meter)).toThrow("doesn't apply to a 'NoneType' object");
    expect(() => readRuntimeGetsetDescriptor(member, v.instance(registry.object), type, meter)).toThrow("doesn't apply to a 'object' object");
    wrapper.state.initialize(v.false, () => v.none, meter);
    expect(readRuntimeGetsetDescriptor(member, wrapper, type, meter)).toBe(v.false);
    wrapper.state.initialize(v.true, () => v.none, meter);
  }
});

it("provides intrinsic member data-descriptor slots, identity hashing and native metadata", () => {
  const { meter, v, registry } = fixture(), receiver = v.instance(registry.object);
  let stored: RuntimeValue = v.true;
  const member = v.memberDescriptor({ owner: registry.object, name: "field", accepts: value => value === receiver, get: () => stored, set: (_receiver, value) => { stored = value; }, delete: () => { stored = v.none; } });
  const resolved = resolveRuntimeClassAttribute(member, { slots() { throw Error("must use intrinsic slots"); } }, v, meter);
  expect(resolved.slots?.get?.(receiver, registry.object)).toBe(v.true);
  resolved.slots?.set?.(receiver, v.false); expect(stored).toBe(v.false);
  resolved.slots?.delete?.(receiver); expect(stored).toBe(v.none);
  expect(runtimeTruth(member, meter)).toBe(true); expect(runtimeCallable(member, meter)).toBe(false);
  expect(runtimeHash(member, { none: v.none, identity: () => 31n, string: () => 0n, bytes: () => 0n }, meter)).toBe(31n);
  expect(() => readRuntimeGetsetDescriptor(member, null, v.none, meter)).toThrow("__get__(None, None) is invalid");
  expect(() => readRuntimeGetsetDescriptor(member, receiver, v.none, meter)).not.toThrow();
});
