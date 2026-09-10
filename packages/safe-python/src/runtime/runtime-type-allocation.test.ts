import { expect, it } from "vitest";
import { allocateRuntimeType } from "./runtime-type-allocation.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTypeAttribute } from "./runtime-type-attributes.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { createFunctionState } from "./function-state.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), namespace = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const create = () => allocateRuntimeType(v.string("C"), [], namespace, registry.type, registry, v, meter, { module: v.string("example") });
  return { meter, v, registry, namespace, create };
}

it("allocates fresh owned classes with default object bases and copied namespace storage", () => {
  const { v, registry, namespace, create } = fixture(), member = v.list([]);
  namespace.items.set(v.string("member"), member);
  const first = create(), second = create();
  expect(first === second).toBe(false); expect(first.metaclass).toBe(registry.type);
  expect(registry.metadata(first, "bases").items).toEqual([registry.object]); expect(registry.resolve(first.value)).toBe(first);
  expect(first.value.namespace === namespace).toBe(false); expect(first.value.namespace.items.lookup(v.string("member"))?.value).toBe(member);
  namespace.items.set(v.string("member"), v.none); expect(first.value.namespace.items.lookup(v.string("member"))?.value).toBe(member);
  first.value.namespace.items.set(v.string("other"), v.true); expect(second.value.namespace.items.lookup(v.string("other"))).toBeUndefined();
});

it("extracts qualified names without changing the source namespace or ordinary name shadow", () => {
  const { v, meter, namespace, create } = fixture(), qualified = v.string("Outer.C");
  namespace.items.set(v.string("__qualname__"), qualified); namespace.items.set(v.string("__name__"), v.string("shadow"));
  const cls = create(); expect(cls.value.name).toBe("C"); expect(cls.value.names.get("__qualname__", v, meter)).toBe(qualified);
  expect(cls.value.namespace.items.lookup(v.string("__qualname__"))).toBeUndefined();
  expect(namespace.items.lookup(v.string("__qualname__"))?.value).toBe(qualified);
  expect(cls.value.namespace.items.lookup(v.string("__name__"))?.value).toEqual(v.string("shadow"));
});

it("fills and removes the captured class cell only in the owned namespace", () => {
  const { v, namespace, create } = fixture(), cell = v.cell({ content: { value: v.true } }); namespace.items.set(v.string("__classcell__"), cell);
  const cls = create(); expect(cell.value.content?.value).toBe(cls);
  expect(cls.value.namespace.items.lookup(v.string("__classcell__"))).toBeUndefined(); expect(namespace.items.lookup(v.string("__classcell__"))?.value).toBe(cell);
});

it("preserves supplied module/doc values and fills only missing defaults", () => {
  const { v, namespace, create } = fixture(), cls = create();
  expect(cls.value.namespace.items.lookup(v.string("__module__"))?.value).toEqual(v.string("example")); expect(cls.value.namespace.items.lookup(v.string("__doc__"))?.value).toBe(v.none);
  namespace.items.set(v.string("__module__"), v.integer(7)); namespace.items.set(v.string("__doc__"), v.true);
  const supplied = create(); expect(supplied.value.namespace.items.lookup(v.string("__module__"))?.value).toEqual(v.integer(7)); expect(supplied.value.namespace.items.lookup(v.string("__doc__"))?.value).toBe(v.true);
});

it("validates qualified names before class cells and leaves the source unchanged", () => {
  const { v, namespace, create } = fixture(); namespace.items.set(v.string("__qualname__"), v.integer(1)); namespace.items.set(v.string("__classcell__"), v.none);
  expect(create).toThrow("type __qualname__ must be a str, not int"); expect(namespace.items.size).toBe(2);
  namespace.items.delete(v.string("__qualname__")); expect(create).toThrow("__classcell__ must be a nonlocal cell, not <class 'NoneType'>");
});

it("retains the partially initialized class in its cell when MRO construction fails", () => {
  const { v, meter, registry, namespace } = fixture(), cell = v.cell({}); namespace.items.set(v.string("__classcell__"), cell);
  expect(() => allocateRuntimeType(v.string("C"), [registry.object, registry.object], namespace, registry.type, registry, v, meter)).toThrow("duplicate base class object");
  const failed = cell.value.content?.value; expect(failed?.kind).toBe("type");
  if (failed?.kind !== "type") throw Error("expected partially initialized type");
  expect(failed.value.mro).toEqual([]); expect(failed.value.namespace.items.lookup(v.string("__doc__"))).toBeUndefined();
  expect(failed.value.namespace.items.lookup(v.string("__classcell__"))).toBeUndefined();
  expect(registry.resolve(failed.value)).toBe(failed);
  expect(() => registry.metadata(failed, "mro")).toThrow("type MRO is not initialized");
  expect(runtimeTypeAttribute(failed, "__mro__", v, meter, { typeOf: () => registry.type, slots: () => undefined })).toBe(v.none);
});

it("rejects foreign bases without filling the class cell", () => {
  const { v, meter, registry, namespace } = fixture(), other = fixture(), cell = v.cell({}); namespace.items.set(v.string("__classcell__"), cell);
  expect(() => allocateRuntimeType(v.string("C"), [other.registry.object], namespace, registry.type, registry, v, meter)).toThrow("base layout is not published in this type registry");
  expect(cell.value.content).toBeUndefined();
});

it("rejects invalid class names before copying metadata or filling cells", () => {
  const { v, meter, registry, namespace } = fixture(), cell = v.cell({}); namespace.items.set(v.string("__classcell__"), cell); namespace.items.set(v.string("__qualname__"), v.none);
  expect(() => allocateRuntimeType(v.string("a\u0000b"), [], namespace, registry.type, registry, v, meter)).toThrow("type name must not contain null characters");
  expect(cell.value.content).toBeUndefined();
});

it("retains class-cell publication when a later checkpoint terminates allocation", () => {
  const { v, meter, registry, namespace } = fixture(), cell = v.cell({}); namespace.items.set(v.string("__classcell__"), cell);
  const aborting = { checkpoint(steps = 1, bytes = 0) { if (cell.value.content !== undefined) throw Error("stop after publication"); meter.checkpoint(steps, bytes); } };
  expect(() => allocateRuntimeType(v.string("C"), [], namespace, registry.type, registry, v, aborting)).toThrow("stop after publication");
  const cls = cell.value.content?.value; if (cls?.kind !== "type") throw Error("expected retained class");
  expect(cls.value.mro).toEqual([]); expect(registry.resolve(cls.value)).toBe(cls);
});

it("automatically wraps only function-valued reserved class methods in the owned namespace", () => {
  const { v, meter, namespace, create } = fixture(), program = compileProgram(analyzeModule("def f(): pass\n"), { stripDocstring: false }, v, meter);
  const fn = v.function(createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter));
  for (const name of ["__new__", "__init_subclass__", "__class_getitem__", "ordinary"]) namespace.items.set(v.string(name), fn);
  const cls = create();
  for (const [name, kind] of [["__new__", "staticmethod"], ["__init_subclass__", "classmethod"], ["__class_getitem__", "classmethod"], ["ordinary", "function"]]) {
    expect(cls.value.namespace.items.lookup(v.string(name))?.value.kind).toBe(kind); expect(namespace.items.lookup(v.string(name))?.value).toBe(fn);
  }
});

it("does not rewrap explicit method decorators or non-function reserved values", () => {
  const { v, namespace, create } = fixture(), wrapper = v.methodDecorator("staticmethod", v.none), native = v.builtinFunction({ name: "native", invoke: () => v.none });
  namespace.items.set(v.string("__new__"), wrapper); namespace.items.set(v.string("__init_subclass__"), native); namespace.items.set(v.string("__class_getitem__"), v.true);
  const cls = create(); expect(cls.value.namespace.items.lookup(v.string("__new__"))?.value).toBe(wrapper); expect(cls.value.namespace.items.lookup(v.string("__init_subclass__"))?.value).toBe(native); expect(cls.value.namespace.items.lookup(v.string("__class_getitem__"))?.value).toBe(v.true);
});
