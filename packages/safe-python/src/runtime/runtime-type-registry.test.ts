import { describe, expect, it } from "vitest";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { prepareClass } from "./class-preparation.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture() {
  const budget = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }); let failAllocation = false;
  const meter = { checkpoint(steps = 1, bytes = 0) { if (failAllocation && bytes > 0) throw new ExecutionLimitError("allocation"); budget.checkpoint(steps, bytes); } };
  const values = new RuntimeValues(meter), hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const registry = new RuntimeTypeRegistry(values, keys, meter);
  const layout = (name: string, bases = [registry.object.value]) => new RuntimeTypeLayout(name, bases, values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter);
  return { registry, layout, values, meter, fail: (value: boolean) => { failAllocation = value; } };
}

describe("canonical runtime type registry", () => {
  it.each(["__name__", "__qualname__"] as const)("installs intrinsic %s getsets with immutable and deletion guards", name => {
    const { registry, values, meter, layout } = fixture(), cls = registry.publish(layout("C"), registry.type);
    const descriptor = registry.type.value.namespace.items.lookup(values.string(name))!.value;
    if (descriptor.kind !== "getset_descriptor") throw Error("expected name getset");
    expect(readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toEqual(values.string("C"));
    expect(() => mutateRuntimeGetsetDescriptor(descriptor, cls, { kind: "delete" }, meter)).toThrow(`cannot delete '${name}' attribute of immutable type 'C'`);
    for (const builtin of [registry.type, registry.object]) for (const change of [{ kind: "set", value: values.string("new") }, { kind: "delete" }] as const) {
      expect(() => mutateRuntimeGetsetDescriptor(descriptor, builtin, change, meter)).toThrow(`cannot set '${name}' attribute of immutable type '${builtin.value.name}'`);
    }
    const assigned = values.string("Changed"); mutateRuntimeGetsetDescriptor(descriptor, cls, { kind: "set", value: assigned }, meter);
    expect(readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toBe(assigned);
  });
  it("prepares qualified names independently of bases and namespace entries", () => {
    const { registry, values, meter, layout } = fixture(), base = layout("Base"), baseType = registry.publish(base, registry.type), namespace = layout("unused").namespace;
    const code = new RuntimeTypeLayout("C", [base], namespace, meter, { qualifiedName: "Outer.C" }), cls = registry.publish(code, registry.type);
    base.names.set("__name__", values.string("RenamedBase"), meter);
    expect(cls.value.name).toBe("C"); expect(code.names.get("__qualname__", values, meter)).toEqual(values.string("Outer.C"));
    expect(registry.metadata(cls, "mro").items).toEqual([cls, baseType, registry.object]);
  });
  it("bootstraps object and type with their canonical metaclass and inheritance identities", () => {
    const { registry } = fixture();
    expect(registry.type.metaclass).toBe(registry.type); expect(registry.object.metaclass).toBe(registry.type);
    expect(registry.resolve(registry.type.value)).toBe(registry.type); expect(registry.resolve(registry.object.value)).toBe(registry.object);
    expect(registry.metadata(registry.object, "bases").items).toEqual([]);
    expect(registry.metadata(registry.type, "bases").items).toEqual([registry.object]);
    expect(registry.metadata(registry.type, "mro").items).toEqual([registry.type, registry.object]); expect(Object.isFrozen(registry)).toBe(true);
  });
  it("publishes each layout once and rejects conflicting metaclasses", () => {
    const { registry, layout } = fixture(), code = layout("C"), cls = registry.publish(code, registry.type);
    expect(registry.publish(code, registry.type)).toBe(cls);
    const meta = registry.publish(layout("Meta", [registry.type.value]), registry.type);
    expect(() => registry.publish(code, meta)).toThrow("type layout already has a different metaclass"); expect(registry.resolve(code)).toBe(cls);
  });
  it("retains canonical type values in cached diamond MRO and bases tuples", () => {
    const { registry, layout } = fixture(), a = registry.publish(layout("A"), registry.type), b = registry.publish(layout("B"), registry.type);
    const cls = registry.publish(layout("C", [a.value, b.value]), registry.type), mro = registry.metadata(cls, "mro"), bases = registry.metadata(cls, "bases");
    expect(mro.items).toEqual([cls, a, b, registry.object]); expect(bases.items).toEqual([a, b]);
    expect(registry.metadata(cls, "mro")).toBe(mro); expect(registry.metadata(cls, "bases")).toBe(bases);
    expect(Object.isFrozen(mro.items)).toBe(true);
  });
  it("rejects foreign or unpublished types without substituting matching names", () => {
    const state = fixture(), other = fixture(), local = state.layout("C");
    expect(() => state.registry.publish(local, other.registry.type)).toThrow("metaclass is not owned by this type registry");
    const foreignBase = state.layout("Foreign", [other.registry.object.value]);
    expect(() => state.registry.publish(foreignBase, state.registry.type)).toThrow("base layout is not published in this type registry");
    expect(() => state.registry.resolve(local)).toThrow("type layout is not published in this registry");
    const impostor = state.values.type(state.registry.object.value, state.registry.type);
    expect(() => state.registry.metadata(impostor, "mro")).toThrow("type is not owned by this registry");
  });
  it("retains live namespace storage independently of cached immutable metadata", () => {
    const { registry, layout, values } = fixture(), code = layout("C"), cls = registry.publish(code, registry.type), mro = registry.metadata(cls, "mro");
    code.namespace.items.set(values.string("x"), values.true);
    expect(cls.value.namespace).toBe(code.namespace); expect(registry.metadata(cls, "mro")).toBe(mro);
  });
  it("supplies canonical metaclass MROs to class preparation", () => {
    const { registry, layout, values, meter } = fixture();
    const m1 = registry.publish(layout("M1", [registry.type.value]), registry.type), m2 = registry.publish(layout("M2", [m1.value]), registry.type);
    const a = registry.publish(layout("A"), m1), b = registry.publish(layout("B"), m2), namespace = layout("prepared").namespace;
    const result = prepareClass(values.string("C"), values.tuple<RuntimeValue>([a, b]), new Map<string, RuntimeValue>(), {
      defaultType: registry.type, tupleItems: value => value.kind === "tuple" ? value.items : undefined,
      isType: (value): value is TypeValue => value.kind === "type",
      typeOf: value => { if (value.kind !== "type") throw new Error("expected type"); return value.metaclass; },
      mro: value => { if (value.kind !== "type") throw new Error("expected type"); return registry.metadata(value, "mro").items; },
      typeName: value => { if (value.kind !== "type") throw new Error("expected type"); return value.value.name; },
      lookupPrepare: selected => { expect(selected).toBe(m2); return undefined; },
      callPrepare: () => { throw new Error("unexpected prepare hook"); }, emptyNamespace: () => namespace, isMapping: value => value.kind === "dict"
    }, meter);
    expect(result.metaclass).toBe(m2); expect(result.namespace).toBe(namespace);
  });
  it("does not publish a record or cache a metadata tuple after allocation failure", () => {
    const state = fixture(), code = state.layout("C"); state.fail(true);
    expect(() => state.registry.publish(code, state.registry.type)).toThrow(ExecutionLimitError); state.fail(false);
    expect(() => state.registry.resolve(code)).toThrow("type layout is not published in this registry");
    const cls = state.registry.publish(code, state.registry.type); state.fail(true);
    expect(() => state.registry.metadata(cls, "mro")).toThrow(ExecutionLimitError); state.fail(false);
    const mro = state.registry.metadata(cls, "mro"); expect(mro.items).toEqual([cls, state.registry.object]); expect(state.registry.metadata(cls, "mro")).toBe(mro);
  });
});
