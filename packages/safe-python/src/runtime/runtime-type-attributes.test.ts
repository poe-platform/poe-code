import { describe, expect, it } from "vitest";
import { readRuntimeTypeAttribute, mutateRuntimeTypeAttribute, runtimeTypeAttribute, runtimeMutateTypeAttribute } from "./runtime-type-attributes.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import type { DescriptorSlots } from "./instance-attributes.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), namespace = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const meta = registry.publish(new RuntimeTypeLayout("Meta", [registry.type.value], namespace(), meter), registry.type), base = registry.publish(new RuntimeTypeLayout("Base", [registry.object.value], namespace(), meter), meta);
  const cls = registry.publish(new RuntimeTypeLayout("C", [base.value], namespace(), meter), meta);
  const slots = new Map<RuntimeValue, DescriptorSlots<RuntimeValue, RuntimeValue, RuntimeValue>>(), context = { slots: (value: RuntimeValue) => slots.get(value) }, name = v.string("x");
  const read = () => readRuntimeTypeAttribute(cls, name, context, v, meter);
  const set = (value: RuntimeValue) => mutateRuntimeTypeAttribute(cls, name, { kind: "set", value }, context, v, meter);
  const remove = () => mutateRuntimeTypeAttribute(cls, name, { kind: "delete" }, context, v, meter);
  return { v, meter, keys, registry, cls, base, meta, name, slots, context, read, set, remove };
}

describe("concrete default type attribute access", () => {
  it("supports explicit default mutation without applying metaclass overrides", () => {
    const { v, meter, cls, meta, context, name } = fixture();
    meta.value.namespace.items.set(v.string("__setattr__"), v.none); meta.value.namespace.items.set(v.string("__delattr__"), v.none);
    const special = { ...context, typeOf: () => meta };
    runtimeMutateTypeAttribute(cls, "x", { kind: "set", value: v.true }, v, meter, special); expect(cls.value.namespace.items.lookup(name)?.value).toBe(v.true);
    runtimeMutateTypeAttribute(cls, "x", { kind: "delete" }, v, meter, special); expect(cls.value.namespace.items.lookup(name)).toBeUndefined();
  });
  it.each(["set", "delete"] as const)("checks cancellation after class mutation override %s", kind => {
    const controller = new AbortController(), { v, meter, cls, meta, context } = fixture(controller.signal);
    meta.value.namespace.items.set(v.string(kind === "set" ? "__setattr__" : "__delattr__"), v.builtinFunction({ name: "override", invoke: () => v.none }));
    expect(() => runtimeMutateTypeAttribute(cls, "x", kind === "set" ? { kind, value: v.true } : { kind }, v, meter, { ...context, typeOf: () => meta }, { call() { controller.abort(); return v.true; } })).toThrow("execution cancelled");
  });
  it("omits metaclass overrides and fallback when requesting default type lookup", () => {
    const { v, meter, cls, meta, name, context } = fixture();
    cls.value.namespace.items.set(name, v.true);
    meta.value.namespace.items.set(v.string("__getattribute__"), v.none); meta.value.namespace.items.set(v.string("__getattr__"), v.none);
    const special = { ...context, typeOf: () => meta };
    expect(runtimeTypeAttribute(cls, "x", v, meter, special)).toBe(v.true);
    expect(() => runtimeTypeAttribute(cls, "missing", v, meter, special)).toThrow("type object 'C' has no attribute 'missing'");
  });
  it.each(["__getattribute__", "__getattr__"])("checks cancellation after metaclass %s", slot => {
    const controller = new AbortController(), { v, meter, cls, meta, context } = fixture(controller.signal);
    meta.value.namespace.items.set(v.string(slot), v.builtinFunction({ name: slot, invoke: () => v.none }));
    expect(() => runtimeTypeAttribute(cls, "missing", v, meter, { ...context, typeOf: () => meta }, { call() { controller.abort(); return v.true; } })).toThrow("execution cancelled");
  });
  it("keeps immutability local to the type and leaves direct descriptor validation intact", () => {
    const state = fixture();
    expect(state.registry.object.immutable).toBe(true); expect(state.registry.type.immutable).toBe(true);
    expect(state.cls.immutable).toBe(false); expect(state.meta.immutable).toBe(false);
    const descriptor = state.registry.type.value.namespace.items.lookup(state.v.string("__mro__"))!.value;
    if (descriptor.kind !== "getset_descriptor") throw new Error("missing MRO descriptor");
    for (const change of [{ kind: "set", value: state.v.none }, { kind: "delete" }] as const) {
      expect(() => mutateRuntimeGetsetDescriptor(descriptor, state.registry.object, change, state.meter))
        .toThrow("attribute '__mro__' of 'type' objects is not writable");
    }
    expect(state.set(state.v.true)).toBe(true); expect(state.remove()).toBe(true);
  });
  it("meters immutable-type diagnostics and honors cancellation before lookup", () => {
    const controller = new AbortController(), state = fixture(controller.signal), name = state.v.string("long attribute name");
    const budget = new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 1000 });
    expect(() => mutateRuntimeTypeAttribute(state.registry.object, name, { kind: "delete" }, state.context, state.v, budget))
      .toThrow(ExecutionLimitError);
    controller.abort();
    expect(() => mutateRuntimeTypeAttribute(state.registry.object, name, { kind: "delete" }, state.context, state.v, state.meter))
      .toThrow(ExecutionLimitError);
  });
  it("rejects bootstrap type mutation before descriptor lookup or namespace changes", () => {
    const state = fixture(), context = { slots(): never { throw new Error("descriptor lookup must not run"); } };
    state.registry.type.value.namespace.items.set(state.name, state.v.true);
    for (const cls of [state.registry.object, state.registry.type]) {
      for (const [name, representation] of [["x", "'x'"], ["missing", "'missing'"], ["__mro__", "'__mro__'"], ["a'\n𐀀", '"a\'\\n𐀀"']]) {
        const key = state.v.string(name), before = cls.value.namespace.items.lookup(key);
        for (const change of [{ kind: "set", value: state.v.false }, { kind: "delete" }] as const) {
          expect(() => mutateRuntimeTypeAttribute(cls, key, change, context, state.v, state.meter))
            .toThrow(`cannot set ${representation} attribute of immutable type '${cls.value.name}'`);
          expect(cls.value.namespace.items.lookup(key)).toEqual(before);
        }
      }
    }
  });
  it("resolves inherited namespaces and distinguishes None from absence", () => {
    const state = fixture(); expect(state.read()).toBeUndefined(); state.base.value.namespace.items.set(state.name, state.v.none);
    expect(state.read()?.value).toBe(state.v.none); expect(state.remove()).toBe(false);
    expect(state.set(state.v.true)).toBe(true); expect(state.read()?.value).toBe(state.v.true);
    expect(state.remove()).toBe(true); expect(state.read()?.value).toBe(state.v.none);
  });
  it("gives metaclass data descriptors priority and passes the current class/metaclass", () => {
    const state = fixture(), descriptor = state.v.list([]), seen: RuntimeValue[] = [];
    state.meta.value.namespace.items.set(state.name, descriptor); state.cls.value.namespace.items.set(state.name, state.v.false);
    state.slots.set(descriptor, { get(instance, owner) { expect(instance).toBe(state.cls); expect(owner).toBe(state.meta); return state.v.true; }, set(instance, value) { expect(instance).toBe(state.cls); seen.push(value); }, delete(instance) { expect(instance).toBe(state.cls); seen.push(state.v.none); } });
    expect(state.read()?.value).toBe(state.v.true); expect(state.set(state.v.integer(3))).toBe(true); expect(state.remove()).toBe(true);
    expect(seen).toEqual([state.v.integer(3), state.v.none]); expect(state.cls.value.namespace.items.lookup(state.name)?.value).toBe(state.v.false);
  });
  it("shadows metaclass non-data descriptors with class MRO attributes", () => {
    const state = fixture(), descriptor = state.v.list([]); let reads = 0;
    state.meta.value.namespace.items.set(state.name, descriptor); state.base.value.namespace.items.set(state.name, state.v.false);
    state.slots.set(descriptor, { get() { reads++; return state.v.true; } });
    expect(state.read()?.value).toBe(state.v.false); expect(reads).toBe(0);
    state.base.value.namespace.items.delete(state.name); expect(state.read()?.value).toBe(state.v.true); expect(reads).toBe(1);
  });
  it("binds inherited class descriptors with no instance but never uses them for class writes", () => {
    const state = fixture(), descriptor = state.v.list([]);
    state.base.value.namespace.items.set(state.name, descriptor);
    state.slots.set(descriptor, { get(instance, owner) { expect(instance).toBeNull(); expect(owner).toBe(state.cls); return state.v.integer(7); }, set() { throw new Error("class-owned descriptor setter must not run"); } });
    expect(state.read()?.value).toEqual(state.v.integer(7)); state.set(state.v.true); expect(state.read()?.value).toBe(state.v.true); state.remove(); expect(state.read()?.value).toEqual(state.v.integer(7));
  });
  it("honors missing companion slots on metaclass data descriptors", () => {
    const state = fixture(), descriptor = state.v.list([]); state.meta.value.namespace.items.set(state.name, descriptor);
    state.slots.set(descriptor, { delete() {} }); expect(() => state.set(state.v.true)).toThrow("__set__");
    state.slots.set(descriptor, { set() {} }); expect(state.remove).toThrow("__delete__"); expect(state.cls.value.namespace.items.size).toBe(0);
  });
  it("preserves Python code-point attribute names", () => {
    const state = fixture(), pair = state.v.stringPoints(new Uint32Array([0xd800, 0xdc00])), astral = state.v.string("𐀀");
    mutateRuntimeTypeAttribute(state.cls, pair, { kind: "set", value: state.v.true }, state.context, state.v, state.meter);
    mutateRuntimeTypeAttribute(state.cls, astral, { kind: "set", value: state.v.false }, state.context, state.v, state.meter);
    expect(readRuntimeTypeAttribute(state.cls, pair, state.context, state.v, state.meter)?.value).toBe(state.v.true);
    expect(readRuntimeTypeAttribute(state.cls, astral, state.context, state.v, state.meter)?.value).toBe(state.v.false);
  });
  it("does not publish descriptor results after cancellation", () => {
    const controller = new AbortController(), state = fixture(controller.signal), descriptor = state.v.list([]);
    state.meta.value.namespace.items.set(state.name, descriptor); state.slots.set(descriptor, { get() { controller.abort(); return state.v.true; } });
    expect(state.read).toThrow(ExecutionLimitError);
  });
  it("supports class attribute reads, assignments and deletion in assembled programs", () => {
    const state = fixture(), globals = new Map<string, RuntimeValue>([["C", state.cls], ["Meta", state.meta]]), unused = (): never => { throw new Error("unexpected hook"); };
    const hooks: RuntimeProgramHooks = {
      expressions: () => ({ attribute(value, name) { if (value.kind !== "type") return unused(); return readRuntimeTypeAttribute(value, state.v.string(name), state.context, state.v, state.meter)?.value ?? unused(); }, beginSet: unused, warn: unused }),
      statements: () => ({
        setAttribute(value, name, item) { if (value.kind !== "type") return unused(); mutateRuntimeTypeAttribute(value, state.v.string(name), { kind: "set", value: item }, state.context, state.v, state.meter); },
        deleteAttribute(value, name) { if (value.kind !== "type") return unused(); if (!mutateRuntimeTypeAttribute(value, state.v.string(name), { kind: "delete" }, state.context, state.v, state.meter)) unused(); },
        executeUnhandled: unused
      }), callable: () => false, invoke: unused, name: unused, keywordName: unused
    };
    const program = compileProgram<RuntimeValue>(analyzeModule("C.x = 3\nresult = C.x\ndel C.x\ndef f(cls): return 7\nMeta.f = f\nmethod_result = C.f()\n"), { stripDocstring: false }, state.v, state.meter);
    executeRuntimeProgram(program, { globals, builtins: new Map(), values: state.v, keys: state.keys, calls: new CallStack<object>(10, state.meter), hooks }, state.meter);
    expect(globals.get("result")).toEqual(state.v.integer(3)); expect(globals.get("method_result")).toEqual(state.v.integer(7)); expect(state.read()).toBeUndefined();
  });
});
