import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { runtimeActualType } from "./runtime-special-method.js";
import { getRuntimeMethodDecorator } from "./runtime-method-decorator.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0 }, registry = new RuntimeTypeRegistry(v, keys, meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  return { meter, v, registry, keywords };
}

it.each(["staticmethod", "classmethod"] as const)("publishes one execution-owned immutable %s type", kind => {
  const { registry } = fixture(), type = registry.methodDecoratorType(kind);
  expect(registry.methodDecoratorType(kind)).toBe(type); expect(registry.resolve(type.value)).toBe(type);
  expect(type.metaclass).toBe(registry.type); expect(type.immutable).toBe(true);
  expect(registry.metadata(type, "mro").items).toEqual([type, registry.object]);
  expect(type.value.hasObjectLayout).toBe(false); expect(type.value.hasInstanceDictionary).toBe(true);
  expect(fixture().registry.methodDecoratorType(kind) === type).toBe(false);
});

it.each(["staticmethod", "classmethod"] as const)("validates direct %s allocation before ignoring extras", kind => {
  const { registry, v, meter, keywords } = fixture(), type = registry.methodDecoratorType(kind), allocate = type.value.namespace.items.lookup(v.string("__new__"))!.value;
  if (allocate.kind !== "builtin_function_or_method") throw Error("expected allocator");
  keywords.items.set(v.string("ignored"), v.true);
  expect(() => allocate.value.invoke([], keywords, meter)).toThrow(`${kind}.__new__(): not enough arguments`);
  expect(() => allocate.value.invoke([v.none], keywords, meter)).toThrow(`${kind}.__new__(X): X is not a type object (NoneType)`);
  expect(() => allocate.value.invoke([registry.object], keywords, meter)).toThrow(`${kind}.__new__(object): object is not a subtype of ${kind}`);
  expect(() => allocate.value.invoke([fixture().registry.methodDecoratorType(kind)], keywords, meter)).toThrow("type is not owned by this method-wrapper allocator");
  const result = allocate.value.invoke([type, v.true, v.false], keywords, meter);
  if (result.kind !== kind) throw Error("wrong wrapper kind");
  expect(result.value).toBe(v.none); expect(result.type).toBe(type); expect(result.state.attributes.size).toBe(0);
  expect(runtimeActualType(result, { slots: () => undefined, typeOf: () => { throw Error("must use intrinsic type"); } }, meter)).toBe(type);
  const bound = getRuntimeMethodDecorator(v.methodDecorator("classmethod", v.true), result, v.none, v, meter, () => { throw Error("must use intrinsic type"); });
  if (bound.kind !== "method") throw Error("expected method"); expect(bound.value.instance).toBe(type);
});

it.each(["staticmethod", "classmethod"] as const)("rejects wrong-kind and foreign %s initializer receivers", kind => {
  const { registry, v, meter, keywords } = fixture(), type = registry.methodDecoratorType(kind), initialize = type.value.namespace.items.lookup(v.string("__init__"))!.value;
  if (initialize.kind !== "wrapper_descriptor") throw Error("expected native wrapper descriptor");
  const other = kind === "staticmethod" ? "classmethod" : "staticmethod";
  expect(() => callRuntimeMethodDescriptor(initialize, [v.methodDecorator(other, v.true), v.false], keywords, meter)).toThrow(`requires a '${kind}' object`);
  const foreign = fixture().registry.methodDecoratorType(kind);
  expect(() => callRuntimeMethodDescriptor(initialize, [v.methodDecorator(kind, v.true, foreign), v.false], keywords, meter)).toThrow(`requires a '${kind}' object`);
});

it.each(["staticmethod", "classmethod"] as const)("validates native %s __get__ arguments and descriptor markers", kind => {
  const { registry, v, meter, keywords } = fixture(), type = registry.methodDecoratorType(kind), wrapper = v.methodDecorator(kind, v.true, type), get = type.value.namespace.items.lookup(v.string("__get__"))?.value;
  if (get?.kind !== "wrapper_descriptor") throw Error("expected native __get__ wrapper");
  expect(() => callRuntimeMethodDescriptor(get, [wrapper], keywords, meter)).toThrow("__get__ expected at least 1 argument, got 0");
  expect(() => callRuntimeMethodDescriptor(get, [wrapper, v.none, type, v.true], keywords, meter)).toThrow("__get__ expected at most 2 arguments, got 3");
  expect(() => callRuntimeMethodDescriptor(get, [wrapper, v.none], keywords, meter)).toThrow("__get__(None, None) is invalid");
  const bound = callRuntimeMethodDescriptor(get, [wrapper, v.none, type], keywords, meter);
  if (kind === "staticmethod") expect(bound).toBe(v.true);
  else { if (bound.kind !== "method") throw Error("expected method"); expect(bound.value.function).toBe(v.true); expect(bound.value.instance).toBe(type); }
  keywords.items.set(v.string("owner"), type);
  expect(() => callRuntimeMethodDescriptor(get, [wrapper], keywords, meter)).toThrow("wrapper __get__() takes no keyword arguments");
  expect(() => callRuntimeMethodDescriptor(get, [v.none], keywords, meter)).toThrow(`requires a '${kind}' object`);
});

it("installs __call__ only on staticmethod and forwards arguments without binding another receiver", () => {
  const { registry, v, meter, keywords } = fixture(), type = registry.methodDecoratorType("staticmethod"), call = type.value.namespace.items.lookup(v.string("__call__"))?.value;
  if (call?.kind !== "wrapper_descriptor") throw Error("expected staticmethod call wrapper");
  expect(registry.methodDecoratorType("classmethod").value.namespace.items.lookup(v.string("__call__"))).toBeUndefined();
  const payload = v.list([]), wrapper = v.methodDecorator("staticmethod", payload, type), arg = v.integer(7);
  keywords.items.set(v.string("flag"), v.true);
  const result = callRuntimeMethodDescriptor(call, [wrapper, arg], keywords, meter, {
    call(callee, positional, named) { expect(callee).toBe(payload); expect(positional).toEqual([arg]); expect(named).toBe(keywords); return v.false; },
    isStopIteration: () => false
  });
  expect(result).toBe(v.false);
});
