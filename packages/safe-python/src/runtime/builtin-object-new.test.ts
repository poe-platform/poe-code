import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = dictionary();
  const allocator = registry.object.value.namespace.items.lookup(v.string("__new__"))!.value;
  if (allocator.kind !== "builtin_function_or_method") throw Error("expected object allocator");
  const type = (name = "C", base = registry.object, options: RuntimeTypeLayoutOptions = {}) => registry.publish(new RuntimeTypeLayout(name, [base.value], dictionary(), meter, options), registry.type);
  const call = (...args: RuntimeValue[]) => allocator.value.invoke(args, keywords, meter);
  return { v, meter, registry, keywords, allocator, type, call };
}

it("validates object new arity and type arguments", () => {
  const { v, type, call } = fixture();
  expect(() => call()).toThrow("object.__new__(): not enough arguments");
  expect(() => call(v.integer(1))).toThrow("object.__new__(X): X is not a type object (int)");
  expect(() => call(v.none)).toThrow("object.__new__(X): X is not a type object (NoneType)");
  expect(() => call(v.instance(type()))).toThrow("object.__new__(X): X is not a type object (C)");
});

it("allocates object without a dictionary and fresh heap instance dictionaries", () => {
  const { registry, type, call } = fixture(), owner = type(), object = call(registry.object), first = call(owner), second = call(owner);
  if (object.kind !== "instance" || first.kind !== "instance" || second.kind !== "instance") throw Error("expected instances");
  expect(object.type).toBe(registry.object); expect(object.dictionary).toBeUndefined();
  expect(first.type).toBe(owner); expect(first === second).toBe(false); expect(first.dictionary === second.dictionary).toBe(false);
  expect(first.dictionary!.items.size).toBe(0);
});

it("retains inherited dictionaries but allows dictionary-less heap layouts", () => {
  const { type, call } = fixture(), slots = type("Slots", undefined, { instanceDictionary: false }), dict = type("Dict");
  for (const [owner, expected] of [[slots, false], [type("WithDict", slots), true], [type("Inherited", dict, { instanceDictionary: false }), true]] as const) {
    const instance = call(owner); if (instance.kind !== "instance") throw Error("expected instance");
    expect(instance.dictionary !== undefined).toBe(expected);
  }
});

it.each([false, true])("rejects extra arguments with default init, keyword=%s", keyword => {
  const { v, type, keywords, call } = fixture(), owner = type();
  if (keyword) keywords.items.set(v.string("value"), v.true);
  expect(() => keyword ? call(owner) : call(owner, v.true)).toThrow("C() takes no arguments");
});

it("allows init overrides to own argument validation without invoking them", () => {
  const { v, type, keywords, allocator, call } = fixture(), owner = type();
  owner.value.namespace.items.set(v.string("__init__"), v.none);
  owner.value.namespace.items.set(v.string("__new__"), allocator);
  keywords.items.set(v.string("value"), v.true);
  expect(call(owner, v.true).kind).toBe("instance");
});

it("rejects direct extra arguments when the requested type overrides new", () => {
  const { v, type, call } = fixture(), owner = type();
  owner.value.namespace.items.set(v.string("__new__"), v.none);
  owner.value.namespace.items.set(v.string("__init__"), v.none);
  expect(() => call(owner, v.true)).toThrow("object.__new__() takes exactly one argument (the type to instantiate)");
  expect(call(owner).kind).toBe("instance");
});

it("rejects incompatible native layouts and cannot undo inherited unsafety", () => {
  const { v, registry, type, call } = fixture(), native = type("Native", undefined, { objectLayout: false });
  for (const owner of [registry.type, type("Meta", registry.type), native, type("Derived", native, { objectLayout: true })]) {
    expect(() => call(owner, v.true)).toThrow(`object.__new__(${owner.value.name}) is not safe, use ${owner.value.name}.__new__()`);
  }
});

it("does not allocate a type owned by another registry", () => {
  const a = fixture(), b = fixture();
  expect(() => a.call(b.type())).toThrow("type is not owned by this object allocator");
});

it("observes cancellation before allocation", () => {
  const controller = new AbortController(), { type, call } = fixture(controller.signal), owner = type();
  controller.abort(); expect(() => call(owner)).toThrow("execution cancelled");
});
