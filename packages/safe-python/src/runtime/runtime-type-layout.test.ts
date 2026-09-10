import { describe, expect, it } from "vitest";
import { RuntimeTypeLayout, resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const namespace = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const type = (name: string, bases: readonly RuntimeTypeLayout[] = []) => new RuntimeTypeLayout(name, bases, namespace(), meter);
  const resolve = (type: RuntimeTypeLayout, name: string) => resolveRuntimeTypeAttribute(type, v.string(name), { slots: () => undefined }, v, meter);
  return { v, meter, type, namespace, resolve };
}

describe("runtime type inheritance layouts", () => {
  it("shares native storage through heap diamonds and selects more-specific native payloads", () => {
    const { namespace, meter, type } = fixture(), plain = type("Plain");
    const native = new RuntimeTypeLayout("Native", [], namespace(), meter, { objectLayout: false });
    const left = type("Left", [native]), right = type("Right", [native]);
    const diamond = type("Diamond", [left, right]);
    expect(native.nativeStorage).toBe(native); expect(diamond.nativeStorage).toBe(native);
    expect(type("Mix", [plain, native]).nativeStorage).toBe(native);
    const larger = new RuntimeTypeLayout("Larger", [native], namespace(), meter, { objectLayout: false });
    expect(type("Combined", [larger, left]).nativeStorage).toBe(larger);
    expect(type("Reversed", [left, larger]).nativeStorage).toBe(larger);
  });

  it("checks incompatible native bases and base eligibility in left-to-right order", () => {
    const { namespace, meter } = fixture();
    const left = new RuntimeTypeLayout("Left", [], namespace(), meter, { objectLayout: false });
    const right = new RuntimeTypeLayout("Right", [], namespace(), meter, { objectLayout: false });
    const final = new RuntimeTypeLayout("Final", [], namespace(), meter, { subclassable: false });
    let published = false;
    for (const bases of [[left, right], [left, right, final], [left, left, right]]) expect(() => new RuntimeTypeLayout("C", bases, namespace(), meter, { beforeMro() { published = true; } })).toThrow("multiple bases have instance lay-out conflict");
    expect(() => new RuntimeTypeLayout("C", [left, final, right], namespace(), meter)).toThrow("type 'Final' is not an acceptable base type");
    expect(published).toBe(false);
  });
  it("rejects non-subclassable bases before publishing any layout", () => {
    const { namespace, meter, type } = fixture(), base = new RuntimeTypeLayout("Final", [], namespace(), meter, { subclassable: false }), other = type("Other");
    let published = false;
    for (const bases of [[base], [other, base], [base, other], [base, base]]) {
      expect(() => new RuntimeTypeLayout("C", bases, namespace(), meter, { subclassable: true, beforeMro() { published = true; } })).toThrow("type 'Final' is not an acceptable base type");
    }
    expect(published).toBe(false); expect(base.isSubclassable).toBe(false); expect(other.isSubclassable).toBe(true);
  });
  it("exposes frozen allocation metadata before MRO computation, then fills the MRO", () => {
    const { namespace, meter, type } = fixture(), base = type("Base"); let observed: RuntimeTypeLayout | undefined;
    const result = new RuntimeTypeLayout("C", [base], namespace(), meter, { beforeMro(layout) {
      observed = layout; expect(Object.isFrozen(layout)).toBe(true); expect(layout.name).toBe("C"); expect(layout.bases).toEqual([base]); expect(layout.mro).toEqual([]);
    } });
    expect(observed).toBe(result); expect(result.mro).toEqual([result, base]);
  });
  it("retains the empty MRO when allocation callbacks terminate execution", () => {
    const { namespace, meter } = fixture(); let observed: RuntimeTypeLayout | undefined;
    expect(() => new RuntimeTypeLayout("C", [], namespace(), meter, { beforeMro(layout) { observed = layout; throw Error("stop allocation"); } })).toThrow("stop allocation");
    expect(observed?.mro).toEqual([]);
  });
  it("distinguishes absent native sequence tables from empty heap-type tables", () => {
    const { namespace, meter } = fixture();
    const native = new RuntimeTypeLayout("Native", [], namespace(), meter, { sequenceTable: false });
    const heap = new RuntimeTypeLayout("Heap", [native], namespace(), meter);
    expect(native.hasSequenceTable).toBe(false);
    expect(heap.hasSequenceTable).toBe(true);
    expect(Object.isFrozen(heap)).toBe(true);
  });
  it("owns immutable base/MRO metadata while retaining the live namespace", () => {
    const { type, namespace, meter } = fixture(), root = type("object"), bases = [root], dict = namespace();
    const child = new RuntimeTypeLayout("Child", bases, dict, meter); bases.length = 0;
    expect(child.bases).toEqual([root]); expect(child.mro).toEqual([child, root]); expect(child.namespace).toBe(dict);
    expect(Object.isFrozen(child)).toBe(true); expect(Object.isFrozen(child.bases)).toBe(true); expect(Object.isFrozen(child.mro)).toBe(true);
  });
  it("uses C3 order in diamonds and rejects duplicate or inconsistent bases", () => {
    const { type } = fixture(), root = type("object"), a = type("A", [root]), b = type("B", [root]);
    expect(type("D", [a, b]).mro.map(item => item.name)).toEqual(["D", "A", "B", "object"]);
    expect(() => type("Duplicate", [a, a])).toThrow("duplicate base class A");
    const x = type("X", [a, b]), y = type("Y", [b, a]);
    expect(() => type("Conflict", [x, y])).toThrow("Cannot create a consistent method resolution order");
  });
  it("resolves live namespaces in MRO order and reports the defining owner", () => {
    const { type, v, resolve } = fixture(), root = type("object"), a = type("A", [root]), b = type("B", [root]), d = type("D", [a, b]);
    a.namespace.items.set(v.string("x"), v.integer(1)); b.namespace.items.set(v.string("x"), v.integer(2));
    expect(resolve(d, "x")).toMatchObject({ owner: a, attribute: { value: v.integer(1) } });
    a.namespace.items.delete(v.string("x")); expect(resolve(d, "x")?.owner).toBe(b);
    d.namespace.items.set(v.string("x"), v.none); expect(resolve(d, "x")).toMatchObject({ owner: d, attribute: { value: v.none } });
    expect(resolve(d, "missing")).toBeUndefined();
  });
  it("resolves descriptor slots only for the winning class attribute", () => {
    const { type, v, meter } = fixture(), root = type("object"), child = type("Child", [root]), seen: RuntimeValue[] = [];
    root.namespace.items.set(v.string("x"), v.false); child.namespace.items.set(v.string("x"), v.true);
    const slots = { get: () => v.none };
    const found = resolveRuntimeTypeAttribute(child, v.string("x"), { slots(value) { seen.push(value); return slots; } }, v, meter);
    expect(found?.owner).toBe(child); expect(found?.attribute.slots).toBe(slots); expect(seen).toEqual([v.true]);
  });
  it("preserves distinct Python code-point keys across inherited namespaces", () => {
    const { type, v, meter } = fixture(), root = type("object"), child = type("Child", [root]);
    const surrogate = v.stringPoints(new Uint32Array([0xd800, 0xdc00])), astral = v.string("𐀀");
    root.namespace.items.set(surrogate, v.true); root.namespace.items.set(astral, v.false);
    const context = { slots: () => undefined };
    expect(resolveRuntimeTypeAttribute(child, surrogate, context, v, meter)?.attribute.value).toBe(v.true);
    expect(resolveRuntimeTypeAttribute(child, astral, context, v, meter)?.attribute.value).toBe(v.false);
  });
});
