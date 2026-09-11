import { describe, expect, it } from "vitest";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ClassFrame } from "./class-frame.js";
import { analyzeModule } from "../analysis.js";
import { RuntimeTypeLayout, resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { PythonRuntimeError } from "./error.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const namespace = new RuntimeDictionaryNamespace(dictionary, v, meter);
  return { meter, v, dictionary, namespace, hash };
}

describe("dictionary-backed runtime namespaces", () => {
  it("rejects values without dictionary storage at construction", () => {
    const { v, meter } = fixture();
    expect(() => new RuntimeDictionaryNamespace(v.none, v, meter)).toThrow(TypeError);
  });
  it("shares live storage while distinguishing missing names from None", () => {
    const { namespace, dictionary, v } = fixture();
    expect(namespace.lookup("x")).toBeUndefined(); namespace.store("x", v.none);
    expect(dictionary.items.lookup(v.string("x"))?.value).toBe(v.none);
    dictionary.items.set(v.string("x"), v.true); expect(namespace.lookup("x")?.value).toBe(v.true);
    expect(namespace.delete("x")).toBe(true); expect(namespace.delete("x")).toBe(false);
    expect(Object.isFrozen(namespace)).toBe(true);
  });
  it("does not normalize names or erase unrelated non-string keys", () => {
    const { namespace, dictionary, v } = fixture();
    dictionary.items.set(v.integer(1), v.none);
    namespace.store("K", v.true); namespace.store("K", v.false);
    expect(namespace.lookup("K")?.value).toBe(v.true); expect(namespace.lookup("K")?.value).toBe(v.false);
    expect(dictionary.items.size).toBe(3); expect(dictionary.items.lookup(v.integer(1))?.value).toBe(v.none);
  });
  it("connects class frame mangling and global routing to live MRO lookup", () => {
    const { namespace, dictionary, v, meter } = fixture();
    const scope = analyzeModule("class C:\n global shared\n __private = 1\n shared = 2\n").scopes.children[0];
    const globals = new Map<string, RuntimeValue>(), builtins = new RuntimeDictionaryNamespace(v.dictionary(dictionary.items.copy()), v, meter);
    builtins.store("fallback", v.true);
    const frame = new ClassFrame(scope, { globals, builtins, locals: namespace }, meter);
    frame.store("__private", v.integer(1)); frame.store("shared", v.integer(2));
    expect(frame.load("fallback")).toBe(v.true); expect(globals.get("shared")).toEqual(v.integer(2));
    expect(namespace.lookup("shared")).toBeUndefined();
    const layout = new RuntimeTypeLayout("C", [], dictionary, meter);
    const lookup = () => resolveRuntimeTypeAttribute(layout, v.string("_C__private"), { slots: () => undefined }, v, meter);
    expect(lookup()?.attribute.value).toEqual(v.integer(1));
    frame.delete("__private"); expect(lookup()).toBeUndefined();
  });
  it("classifies only guest runtime errors, not host or resource failures", () => {
    const { namespace } = fixture();
    expect(namespace.isGuest(new PythonRuntimeError("KeyError", "missing"))).toBe(true);
    expect(namespace.isGuest(new Error("host"))).toBe(false);
    const controller = new AbortController(), state = fixture(controller.signal); controller.abort();
    let fault: unknown; try { state.namespace.lookup("x"); } catch (error) { fault = error; }
    expect(fault).toBeInstanceOf(ExecutionLimitError); expect(namespace.isGuest(fault)).toBe(false);
  });
  it("does not turn dictionary policy failures into missing names", () => {
    const { namespace, hash } = fixture(), fault = new PythonRuntimeError("ValueError", "hash failed");
    hash.string = () => { throw fault; };
    expect(() => namespace.lookup("x")).toThrow(fault);
    expect(() => namespace.store("x", fixture().v.none)).toThrow(fault);
    expect(() => namespace.delete("x")).toThrow(fault);
  });
});
