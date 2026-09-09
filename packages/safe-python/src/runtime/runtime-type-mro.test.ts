import { describe, expect, it } from "vitest";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { readRuntimeTypeAttribute, mutateRuntimeTypeAttribute } from "./runtime-type-attributes.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), name = v.string("__mro__");
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter), registry.type);
  const descriptor = registry.type.value.namespace.items.lookup(name)?.value;
  if (descriptor?.kind !== "getset_descriptor") throw new Error("missing MRO descriptor");
  const context = { slots: () => undefined };
  return { v, meter, registry, cls, descriptor, name, context };
}

describe("intrinsic type MRO getset descriptor", () => {
  it("returns cached hierarchy tuples and cannot be shadowed by class namespace values", () => {
    const state = fixture(); state.cls.value.namespace.items.set(state.name, state.v.false);
    expect(readRuntimeTypeAttribute(state.cls, state.name, state.context, state.v, state.meter)?.value).toBe(state.registry.metadata(state.cls, "mro"));
    expect(readRuntimeTypeAttribute(state.registry.type, state.name, state.context, state.v, state.meter)?.value).toBe(state.registry.metadata(state.registry.type, "mro"));
    expect(state.descriptor.value.owner).toBe(state.registry.type);
  });
  it("rejects assignment and deletion through its data descriptor slots", () => {
    const state = fixture();
    for (const change of [{ kind: "set", value: state.v.none } as const, { kind: "delete" } as const])
      expect(() => mutateRuntimeTypeAttribute(state.cls, state.name, change, state.context, state.v, state.meter)).toThrow("attribute '__mro__' of 'type' objects is not writable");
    expect(state.cls.value.namespace.items.lookup(state.name)).toBeUndefined();
  });
  it("handles class access markers without requiring a type owner argument", () => {
    const { descriptor, v, meter } = fixture();
    expect(readRuntimeGetsetDescriptor(descriptor, null, v.integer(1), meter)).toBe(descriptor);
    expect(readRuntimeGetsetDescriptor(descriptor, v.none, v.true, meter)).toBe(descriptor);
    expect(() => readRuntimeGetsetDescriptor(descriptor, v.none, v.none, meter)).toThrow("__get__(None, None) is invalid");
  });
  it("checks receiver applicability before read-only errors", () => {
    const { descriptor, v, meter } = fixture();
    expect(() => readRuntimeGetsetDescriptor(descriptor, v.integer(1), v.none, meter)).toThrow("descriptor '__mro__' for 'type' objects doesn't apply to a 'int' object");
    expect(() => mutateRuntimeGetsetDescriptor(descriptor, v.integer(1), { kind: "set", value: v.none }, meter)).toThrow("doesn't apply to a 'int' object");
  });
  it("supports explicit writable capabilities while retaining method owners", () => {
    const { cls, registry, v, meter, context } = fixture(); let current: RuntimeValue = v.none;
    const capability = { owner: registry.type, name: "value", accepts: (value: RuntimeValue) => value.kind === "type", get() { expect(this).toBe(capability); return current; }, set(_receiver: RuntimeValue, value: RuntimeValue) { expect(this).toBe(capability); current = value; }, delete() { expect(this).toBe(capability); current = v.none; } };
    const descriptor = v.getsetDescriptor(capability), key = v.string("value"); registry.type.value.namespace.items.set(key, descriptor);
    mutateRuntimeTypeAttribute(cls, key, { kind: "set", value: v.true }, context, v, meter); expect(readRuntimeTypeAttribute(cls, key, context, v, meter)?.value).toBe(v.true);
    mutateRuntimeTypeAttribute(cls, key, { kind: "delete" }, context, v, meter); expect(current).toBe(v.none);
  });
  it("uses intrinsic descriptor identity, truth and iteration diagnostics", () => {
    const { descriptor, v, meter } = fixture(); expect(runtimeTruth(descriptor, meter)).toBe(true);
    expect(runtimeHash(descriptor, { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, meter)).toBe(17n);
    expect(() => runtimeIterate(descriptor, v, meter)).toThrow("'getset_descriptor' object is not iterable");
  });
  it("stops after a capability cancels instead of publishing its result", () => {
    const controller = new AbortController(), { cls, registry, v, meter } = fixture(controller.signal);
    const descriptor = v.getsetDescriptor({ owner: registry.type, name: "x", accepts: () => true, get() { controller.abort(); return v.true; } });
    expect(() => readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toThrow(ExecutionLimitError);
  });
  it("stops between applicability checks and accessors after cancellation", () => {
    const controller = new AbortController(), { cls, registry, v, meter } = fixture(controller.signal); let called = false;
    const descriptor = v.getsetDescriptor({ owner: registry.type, name: "x", accepts() { controller.abort(); return true; }, get() { called = true; return v.true; } });
    expect(() => readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toThrow(ExecutionLimitError); expect(called).toBe(false);
  });
});
