import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = dictionary();
  const initializer = registry.object.value.namespace.items.lookup(v.string("__init__"))?.value;
  if (initializer?.kind !== "wrapper_descriptor") throw Error("expected object initializer wrapper");
  const owner = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), registry.type);
  const call = (...args: RuntimeValue[]) => callRuntimeMethodDescriptor(initializer, args, keywords, meter);
  return { v, meter, registry, initializer, owner, keywords, call, dictionary };
}

it("returns None without consulting type metadata when no extra arguments exist", () => {
  const { v, owner, call, registry } = fixture();
  for (const value of [v.none, v.integer(1), v.list([]), v.instance(owner), registry.type]) expect(call(value)).toBe(v.none);
});

it("requires a receiver through the native wrapper call convention", () => {
  const { call } = fixture();
  expect(() => call()).toThrow("descriptor '__init__' of 'object' object needs an argument");
});

it.each([false, true])("rejects extra default initializer arguments, keyword=%s", keyword => {
  const { v, owner, keywords, call } = fixture();
  if (keyword) keywords.items.set(v.string("x"), v.true);
  expect(() => keyword ? call(v.instance(owner)) : call(v.instance(owner), v.true)).toThrow("C.__init__() takes exactly one argument (the instance to initialize)");
});

it.each([false, true])("rejects direct extra arguments when init is overridden, customNew=%s", customNew => {
  const { v, owner, call } = fixture();
  owner.value.namespace.items.set(v.string("__init__"), v.none);
  if (customNew) owner.value.namespace.items.set(v.string("__new__"), v.none);
  expect(() => call(v.instance(owner), v.true)).toThrow("object.__init__() takes exactly one argument (the instance to initialize)");
  expect(call(v.instance(owner))).toBe(v.none);
});

it.each([false, true])("allows custom allocators to own argument validation, keyword=%s", keyword => {
  const { v, owner, keywords, call } = fixture();
  owner.value.namespace.items.set(v.string("__new__"), v.none);
  if (keyword) keywords.items.set(v.string("x"), v.true);
  expect(keyword ? call(v.instance(owner)) : call(v.instance(owner), v.true)).toBe(v.none);
});

it("treats an explicit alias of the canonical initializer as default", () => {
  const { v, owner, initializer, call } = fixture();
  owner.value.namespace.items.set(v.string("__init__"), initializer);
  expect(() => call(v.instance(owner), v.true)).toThrow("C.__init__() takes exactly one argument (the instance to initialize)");
});

it("observes cancellation before initializing an object", () => {
  const controller = new AbortController(), { v, owner, call } = fixture(controller.signal), instance = v.instance(owner);
  controller.abort(); expect(() => call(instance)).toThrow("execution cancelled");
});

it("uses explicit actual-type policy for native payloads with extra arguments", () => {
  const { v, meter, owner, initializer, keywords } = fixture(), instance = v.integer(1);
  owner.value.namespace.items.set(v.string("__new__"), v.none);
  const invocation = { actualType(value: RuntimeValue) { expect(value).toBe(instance); return owner; }, call: () => { throw Error("must not call guest code"); }, isStopIteration: () => false };
  expect(callRuntimeMethodDescriptor(initializer, [instance, v.true], keywords, meter, invocation)).toBe(v.none);
});

it("checks cancellation after actual-type classification", () => {
  const controller = new AbortController(), { v, meter, owner, initializer, keywords } = fixture(controller.signal);
  const invocation = { actualType() { controller.abort(); return owner; }, call: () => v.none, isStopIteration: () => false };
  expect(() => callRuntimeMethodDescriptor(initializer, [v.integer(1), v.true], keywords, meter, invocation)).toThrow("execution cancelled");
});

it("ignores an instance dictionary shadow of __class__", () => {
  const { v, owner, dictionary, call } = fixture(), storage = dictionary();
  storage.items.set(v.string("__class__"), v.none);
  const instance = v.instance(owner, storage);
  expect(() => call(instance, v.true)).toThrow("C.__init__() takes exactly one argument (the instance to initialize)");
});
