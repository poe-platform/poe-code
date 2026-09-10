import { expect, it } from "vitest";
import { lookupRuntimeSpecialMethod } from "./runtime-special-method.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { analyzeModule } from "../analysis.js";
import { executeRuntimeProgram } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b };
  const registry = new RuntimeTypeRegistry(v, keys, meter);
  const base = registry.publish(new RuntimeTypeLayout("Base", [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter), registry.type);
  const derived = registry.publish(new RuntimeTypeLayout("Derived", [base.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter), registry.type);
  return { meter, v, base, derived };
}

it("distinguishes missing special methods from disabled slots and observes live MRO updates", () => {
  const { meter, v, base, derived } = fixture(), receiver = v.cell({}), name = v.string("__abs__");
  const context = { slots: () => undefined };
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, context, v, meter)).toBeUndefined();
  base.value.namespace.items.set(name, v.none);
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, context, v, meter)).toBe(v.none);
  derived.value.namespace.items.set(name, v.false);
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, context, v, meter)).toBe(v.false);
  derived.value.namespace.items.delete(name);
  base.value.namespace.items.set(name, v.true);
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, context, v, meter)).toBe(v.true);
});

it("binds inherited functions to the receiver without reading instance attributes", () => {
  const { meter, v, base, derived } = fixture(), receiver = v.list([]), name = v.string("__abs__");
  const program = compileProgram<RuntimeValue>(analyzeModule("def special(self): return self\n"), { stripDocstring: false }, v, meter);
  const fn = v.function(createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter));
  base.value.namespace.items.set(name, fn);
  const result = lookupRuntimeSpecialMethod(receiver, derived, name, { slots() { throw Error("native function descriptor must bypass guest inspection"); } }, v, meter);
  if (result?.kind !== "method") throw Error("expected bound method");
  expect(result.value.function).toBe(fn); expect(result.value.instance).toBe(receiver);
  const globals = new Map<string, RuntimeValue>([["bound", result]]), unused = (): never => { throw Error("unexpected guest callback"); };
  const caller = compileProgram<RuntimeValue>(analyzeModule("result=bound()\n"), { stripDocstring: false }, v, meter);
  executeRuntimeProgram(caller, {
    values: v, globals, builtins: new Map(), keys: { hash: () => 1n, equal: (a,b) => a === b }, calls: new CallStack<object>(50, meter),
    hooks: { expressions: () => ({ warn() {} }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "special()", keywordName: unused, invoke: unused }
  }, meter);
  expect(globals.get("result")).toBe(receiver);
});

it("binds the winning descriptor with the actual receiver type, not its defining ancestor", () => {
  const { meter, v, base, derived } = fixture(), receiver = v.cell({}), descriptor = v.cell({}), answer = v.cell({}), name = v.string("__round__");
  base.value.namespace.items.set(name, descriptor); let bindings = 0;
  const slots = { get(instance: RuntimeValue | null, owner: RuntimeValue) { expect(this).toBe(slots); expect(instance).toBe(receiver); expect(owner).toBe(derived); bindings++; return answer; } };
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, { slots(value) { expect(value).toBe(descriptor); return slots; } }, v, meter)).toBe(answer);
  expect(bindings).toBe(1);
});

it("does not search the receiver type's metaclass for instance special methods", () => {
  const { meter, v, derived } = fixture(), receiver = v.cell({}), name = v.string("__abs__");
  derived.metaclass.value.namespace.items.set(name, v.true);
  expect(lookupRuntimeSpecialMethod(receiver, derived, name, { slots() { throw Error("missing slots must not inspect descriptors"); } }, v, meter)).toBeUndefined();
});

it("propagates descriptor AttributeError rather than treating it as an absent method", () => {
  const { meter, v, base, derived } = fixture(), receiver = v.cell({}), name = v.string("__abs__"), failure = new PythonRuntimeError("AttributeError", "descriptor failed");
  base.value.namespace.items.set(name, v.cell({}));
  expect(() => lookupRuntimeSpecialMethod(receiver, derived, name, { slots: () => ({ get() { throw failure; } }) }, v, meter)).toThrow(failure);
});

it.each(["slots", "get"])("observes cancellation after special-method %s resolution", phase => {
  const { v, base, derived } = fixture(), receiver = v.cell({}), name = v.string("__abs__"); let cancelled = false;
  base.value.namespace.items.set(name, v.cell({}));
  expect(() => lookupRuntimeSpecialMethod(receiver, derived, name, { slots() {
    if (phase === "slots") cancelled = true;
    return { get() { if (phase === "slots") throw Error("must stop before binding"); cancelled = true; return v.true; } };
  } }, v, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
