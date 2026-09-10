import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type BuiltinInvocationContext, type RuntimeValue } from "./runtime-values.js";
import { RuntimeMappingNamespace } from "./runtime-mapping-namespace.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter), mapping = v.cell({});
  const hooks = new Map<string, RuntimeValue>(), calls: RuntimeValue[][] = [];
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 0n, equal: (a, b) => a === b }, meter));
  const invocation: BuiltinInvocationContext = {
    lookupSpecial(object, name) { expect(object).toBe(mapping); return hooks.get(name); },
    call(hook, args) { calls.push([...args]); if (hook.kind !== "builtin_function_or_method") throw new PythonRuntimeError("TypeError", "not callable"); return hook.value.invoke(args, keywords, meter); },
    isStopIteration: () => false
  };
  const namespace = new RuntimeMappingNamespace(mapping, v, meter, invocation);
  return { meter, v, hooks, calls, invocation, namespace };
}

it("keeps original name spelling and None values with live special-slot lookup", () => {
  const { v, hooks, calls, namespace } = fixture();
  hooks.set("__getitem__", v.builtinFunction({ name: "get", invoke: () => v.none }));
  expect(namespace.lookup("K")?.value).toBe(v.none);
  hooks.set("__getitem__", v.builtinFunction({ name: "get", invoke: () => v.true }));
  expect(namespace.lookup("K")?.value).toBe(v.true);
  expect(calls).toEqual([[v.string("K")], [v.string("K")]]); expect(Object.isFrozen(namespace)).toBe(true);
});

it("converts only missing-key lookup failures and leaves writes unchanged", () => {
  const { v, hooks, namespace } = fixture();
  const missing = new PythonRuntimeError("KeyError", "missing"), other = new PythonRuntimeError("ValueError", "denied");
  hooks.set("__getitem__", v.builtinFunction({ name: "get", invoke() { throw missing; } }));
  expect(namespace.lookup("x")).toBeUndefined();
  hooks.set("__getitem__", v.builtinFunction({ name: "get", invoke() { throw other; } }));
  expect(() => namespace.lookup("x")).toThrow(other);
  hooks.set("__setitem__", v.builtinFunction({ name: "set", invoke() { throw missing; } }));
  expect(() => namespace.store("x", v.none)).toThrow(missing);
  hooks.set("__delitem__", v.builtinFunction({ name: "delete", invoke() { throw missing; } }));
  expect(namespace.delete("x")).toBe(false);
  hooks.set("__delitem__", v.builtinFunction({ name: "delete", invoke() { throw other; } }));
  expect(() => namespace.delete("x")).toThrow(other);
});

it("ignores successful mutation results and passes the exact value identity", () => {
  const { v, hooks, calls, namespace } = fixture(), value = v.list([]);
  for (const name of ["__setitem__", "__delitem__"]) hooks.set(name, v.builtinFunction({ name, invoke: () => v.false }));
  namespace.store("x", value); expect(namespace.delete("x")).toBe(true);
  expect(calls).toEqual([[v.string("x"), value], [v.string("x")]]); expect(calls[0][1]).toBe(value);
});

it("does not confuse noncallable hooks or host faults with missing names", () => {
  const { v, hooks, invocation, namespace } = fixture(); hooks.set("__getitem__", v.none);
  expect(() => namespace.lookup("x")).toThrow("not callable");
  const fault = new Error("host fault"); invocation.lookupSpecial = () => { throw fault; };
  expect(() => namespace.lookup("x")).toThrow(fault); expect(namespace.isGuest(fault)).toBe(false);
  expect(namespace.isGuest(new PythonRuntimeError("KeyError", "missing"))).toBe(true);
});

it("preserves cancellation when a slot raises KeyError after aborting", () => {
  const controller = new AbortController(), { v, hooks, namespace } = fixture(controller.signal);
  hooks.set("__getitem__", v.builtinFunction({ name: "get", invoke() { controller.abort(); throw new PythonRuntimeError("KeyError", "missing"); } }));
  expect(() => namespace.lookup("x")).toThrow(ExecutionLimitError);
});
