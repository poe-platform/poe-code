import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), namespace = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], namespace, meter, { qualifiedName: "Outer.C" }), registry.type);
  const descriptor = registry.type.value.namespace.items.lookup(v.string("__repr__"))!.value;
  if (descriptor.kind !== "wrapper_descriptor") throw Error("expected native wrapper descriptor");
  const keywords = v.dictionary(namespace.items.emptyCopy());
  const repr = () => callRuntimeMethodDescriptor(descriptor, [cls], keywords, meter);
  return { v, meter, registry, namespace, cls, descriptor, keywords, repr };
}

it("uses live qualified names and only string module metadata without escaping", () => {
  const { v, namespace, repr } = fixture();
  for (const [module, expected] of [[v.none, "C"], [v.integer(7), "C"], [v.string("builtins"), "C"], [v.string(""), ".Outer.C"], [v.string("a'\n\0"), "a'\n\0.Outer.C"]] as const) {
    namespace.items.set(v.string("__module__"), module); expect(repr()).toEqual(v.string(`<class '${expected}'>`));
  }
});

it("preserves separate surrogate code points and never binds module descriptors", () => {
  const { v, namespace, repr } = fixture();
  namespace.items.set(v.string("__module__"), v.stringPoints(new Uint32Array([0xd800, 0xdc00])));
  const result = repr(); if (result.kind !== "str") throw Error("expected representation");
  expect([...result.value]).toEqual([...v.string("<class '").value, 0xd800, 0xdc00, ...v.string(".Outer.C'>").value]);
  namespace.items.set(v.string("__module__"), v.builtinFunction({ name: "module", invoke() { throw Error("must not invoke metadata"); } }));
  expect(repr()).toEqual(v.string("<class 'C'>"));
});

it("validates wrapper receivers, keywords and arity in native order", () => {
  const { v, meter, cls, descriptor, keywords } = fixture();
  expect(() => callRuntimeMethodDescriptor(descriptor, [], keywords, meter)).toThrow("descriptor '__repr__' of 'type' object needs an argument");
  expect(() => callRuntimeMethodDescriptor(descriptor, [v.none], keywords, meter)).toThrow("descriptor '__repr__' requires a 'type' object but received a 'NoneType'");
  expect(() => callRuntimeMethodDescriptor(descriptor, [cls, v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("flag"), v.none);
  expect(() => callRuntimeMethodDescriptor(descriptor, [cls, v.none], keywords, meter)).toThrow("wrapper __repr__() takes no keyword arguments");
});

it("does not return a representation after cancellation", () => {
  const controller = new AbortController(), { repr } = fixture(controller.signal); controller.abort();
  expect(repr).toThrow("execution cancelled");
});
