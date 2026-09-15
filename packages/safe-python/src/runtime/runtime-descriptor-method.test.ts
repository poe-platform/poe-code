import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import type { IntrinsicDescriptorKind } from "./runtime-descriptor-method.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

const kinds = ["function", "method_descriptor", "classmethod_descriptor", "wrapper_descriptor", "getset_descriptor", "member_descriptor"] as const;

function fixture() {
  const budget = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }); let cancelled = false;
  const meter = { checkpoint(steps = 1, bytes = 0) { if (cancelled) throw new ExecutionLimitError("cancelled"); budget.checkpoint(steps, bytes); } };
  const v = new RuntimeValues(meter), keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const self = v.instance(registry.object), events: string[] = [];
  const capabilities = { owner: registry.object, name: "item", accepts: (value: RuntimeValue) => value === self, invoke: () => { events.push("call"); return v.true; } };
  const getset = { ...capabilities, get: () => { events.push("get"); return v.true; }, set: (_self: RuntimeValue, value: RuntimeValue) => { events.push(`set:${value.kind}`); }, delete: () => { events.push("delete"); } };
  function descriptor(kind: IntrinsicDescriptorKind): RuntimeValue {
    if (kind === "function") {
      const program = compileProgram<RuntimeValue>(analyzeModule("def f(self): return self\n"), { stripDocstring: false }, v, meter);
      return v.function(createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter));
    }
    if (kind === "method_descriptor") return v.methodDescriptor(capabilities);
    if (kind === "classmethod_descriptor") return v.classMethodDescriptor({ ...capabilities, accepts: value => value === registry.object });
    if (kind === "wrapper_descriptor") return v.wrapperDescriptor(capabilities);
    if (kind === "getset_descriptor") return v.getsetDescriptor(getset);
    return v.memberDescriptor(getset);
  }
  const actualType = (value: RuntimeValue) => value.kind === "instance" ? value.type : value.kind === "type" ? value.metaclass : registry.descriptorType(value.kind as IntrinsicDescriptorKind);
  const read = (value: RuntimeValue, name: string) => runtimeNativeAttribute(value, name, v, meter, undefined, undefined, { actualType });
  function invoke(value: RuntimeValue, args: readonly RuntimeValue[], keywords = dictionary()): RuntimeValue {
    if (value.kind !== "method-wrapper" && value.kind !== "wrapper_descriptor") throw Error("expected descriptor protocol wrapper");
    return callRuntimeMethodDescriptor(value, args, keywords, meter, { actualType, call() { throw Error("unexpected guest call"); }, isStopIteration: () => false });
  }
  return { v, meter, registry, dictionary, self, events, descriptor, read, invoke, cancel() { cancelled = true; } };
}

it.each(kinds)("publishes canonical %s descriptor types and bound protocol wrappers", kind => {
  const state = fixture(), { registry, v } = state, owner = registry.descriptorType(kind), descriptor = state.descriptor(kind);
  expect(registry.descriptorType(kind)).toBe(owner); expect(registry.resolve(owner.value)).toBe(owner);
  expect(owner.immutable).toBe(true); expect(owner.value.hasObjectLayout).toBe(false);
  const first = state.read(descriptor, "__get__"), second = state.read(descriptor, "__get__");
  expect(first.kind).toBe("method-wrapper"); expect(first).not.toBe(second);
  expect(state.read(first, "__self__")).toBe(descriptor); expect(state.read(first, "__objclass__")).toBe(owner);
  expect(state.read(first, "__qualname__")).toEqual(v.string(`${kind}.__get__`));
  if (kind !== "classmethod_descriptor") expect(state.invoke(first, [v.none, v.true])).toBe(descriptor);
  const result = state.invoke(first, [state.self]);
  expect(result.kind).toBe(kind === "function" ? "method" : kind === "wrapper_descriptor" ? "method-wrapper" : kind === "getset_descriptor" || kind === "member_descriptor" ? "bool" : "builtin_function_or_method");
  expect(state.events).toEqual(kind === "getset_descriptor" || kind === "member_descriptor" ? ["get"] : []);
});

it.each(kinds)("validates %s explicit get arity before descriptor applicability", kind => {
  const state = fixture(), descriptor = state.descriptor(kind), get = state.read(descriptor, "__get__"), { v } = state;
  expect(() => state.invoke(get, [])).toThrow("__get__ expected at least 1 argument, got 0");
  expect(() => state.invoke(get, [v.none, v.none, v.none])).toThrow("__get__ expected at most 2 arguments, got 3");
  expect(() => state.invoke(get, [v.none])).toThrow("__get__(None, None) is invalid");
  const keywords = state.dictionary(); keywords.items.set(v.string("x"), v.none);
  expect(() => state.invoke(get, [], keywords)).toThrow("wrapper __get__() takes no keyword arguments");
  const raw = state.registry.descriptorType(kind).value.namespace.items.lookup(v.string("__get__"))!.value;
  expect(() => state.invoke(raw, [v.true], keywords)).toThrow(`descriptor '__get__' requires a '${kind}' object but received a 'bool'`);
  expect(state.events).toEqual([]);
});

it.each(["getset_descriptor", "member_descriptor"] as const)("exposes %s mutation methods with exact arity and callback order", kind => {
  const state = fixture(), descriptor = state.descriptor(kind), set = state.read(descriptor, "__set__"), remove = state.read(descriptor, "__delete__"), { v } = state;
  expect(() => state.invoke(set, [])).toThrow("__set__ expected 2 arguments, got 0");
  expect(() => state.invoke(remove, [])).toThrow("expected 1 argument, got 0");
  expect(() => state.invoke(set, [v.none, v.true])).toThrow("doesn't apply to a 'NoneType' object");
  expect(state.invoke(set, [state.self, v.true])).toBe(v.none); expect(state.invoke(remove, [state.self])).toBe(v.none);
  expect(state.events).toEqual(["set:bool", "delete"]);
  state.cancel(); expect(() => state.invoke(remove, [state.self])).toThrow(ExecutionLimitError);
  expect(state.events).toEqual(["set:bool", "delete"]);
});

it("preserves ordinary function dictionary shadows over non-data protocol methods", () => {
  const state = fixture(), fn = state.descriptor("function"); if (fn.kind !== "function") throw Error("expected function");
  fn.value.attributes.set("__get__", state.v.true);
  expect(state.read(fn, "__get__")).toBe(state.v.true);
  expect(() => state.read(fn, "__set__")).toThrow("has no attribute '__set__'");
});
