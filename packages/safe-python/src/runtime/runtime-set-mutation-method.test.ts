import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { beginRuntimeSet } from "./runtime-set.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  let hashes = 0;
  const keys = { hash: (key: RuntimeValue) => { hashes++; return runtimeHash(key, context, meter); }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const storage = (...members: RuntimeValue[]) => { const result = new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter); for (const key of members) result.set(key, v.none); return result; };
  const target = v.set(storage()), kwargs = v.dictionary(storage());
  const call = (name: Parameters<typeof createRuntimeSetMutationMethod>[1], args: RuntimeValue[] = []) => createRuntimeSetMutationMethod(target, name, v, meter).value.invoke(args, kwargs, meter);
  return { meter, v, keys, storage, target, kwargs, call, hashes: () => hashes };
}

describe("native mutable-set mutation methods", () => {
  it("adds and discards with one hash each, retaining original equal members", () => {
    const { v, target, call, hashes } = fixture(), first = v.integer(1);
    expect(call("add", [first])).toBe(v.none); const before = hashes();
    expect(call("add", [v.true])).toBe(v.none); expect(hashes() - before).toBe(1);
    expect(target.items.snapshot()[0][0]).toBe(first);
    expect(call("discard", [v.false])).toBe(v.none); expect(target.items.size).toBe(1);
    expect(call("discard", [v.true])).toBe(v.none); expect(target.items.size).toBe(0);
  });

  it("preserves the original missing key in remove's KeyError", () => {
    const { v, call } = fixture(), key = v.tuple([v.true]);
    try { call("remove", [key]); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(PythonKeyError); expect((error as PythonKeyError).args[0]).toBe(key); }
  });

  it.each(["remove", "discard"] as const)("accepts mutable-set probes for %s but never inserts them", name => {
    const { v, storage, target, call } = fixture(), key = v.set(storage(v.true));
    target.items.set(v.frozenSet(storage(v.integer(1))), v.none);
    expect(call(name, [key])).toBe(v.none); expect(target.items.size).toBe(0);
    expect(() => call("add", [key])).toThrow("unhashable type: 'set'");
  });

  it("pops an existing member without hashing and reports empty-set KeyError", () => {
    const { v, target, call, hashes } = fixture(); target.items.set(v.true, v.none); const before = hashes();
    expect(call("pop")).toBe(v.true); expect(hashes()).toBe(before); expect(target.items.size).toBe(0);
    try { call("pop"); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(PythonKeyError); expect((error as PythonKeyError).args).toEqual([v.string("pop from an empty set")]); }
  });

  it("clears live storage and invalidates a size-changed iterator", () => {
    const { v, target, call } = fixture(); target.items.set(v.true, v.none);
    const iterator = target.items.iterate(key => key, "set");
    expect(call("clear")).toBe(v.none); expect(target.items.size).toBe(0);
    expect(() => iterator.next()).toThrow("Set changed size during iteration");
  });

  it("updates from multiple sources and retains earlier progress on failure", () => {
    const { v, target, call } = fixture(), iterator = v.iterator([v.false, v.list([]), v.integer(9)][Symbol.iterator]());
    expect(call("update")).toBe(v.none);
    expect(() => call("update", [v.list([v.true]), iterator])).toThrow("unhashable type: 'list'");
    expect(target.items.snapshot().map(([key]) => key)).toEqual([v.true, v.false]);
    expect(iterator.value.next().value).toEqual(v.integer(9));
  });

  it("allows dictionary-source clearing during update equality callbacks", () => {
    const { meter, v } = fixture(); let active = false;
    const keys = { hash: () => 1n, equal: () => { if (active) source.items.clear(); return false; } };
    const target = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    target.items.set(v.true, v.none); source.items.set(v.false, v.integer(42)); active = true;
    const method = createRuntimeSetMutationMethod(target, "update", v, meter);
    expect(method.value.invoke([source], kwargs, meter)).toBe(v.none);
    expect(target.items.snapshot()).toEqual([[v.true, v.none], [v.false, v.none]]); expect(source.items.size).toBe(0);
  });

  it("compares dictionary-source collisions even when updating an empty set", () => {
    const { meter, v } = fixture(); let fail = false;
    const keys = { hash: () => 1n, equal: () => { if (fail) throw new Error("comparison failed"); return false; } };
    const target = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    source.items.set(v.true, v.integer(42)); source.items.set(v.false, v.integer(43)); fail = true;
    expect(() => createRuntimeSetMutationMethod(target, "update", v, meter).value.invoke([source], kwargs, meter)).toThrow("comparison failed");
    expect(target.items.snapshot()).toEqual([[v.true, v.none]]);
  });

  it.each(["add", "remove", "discard", "pop", "clear", "update"] as const)("validates %s arguments before mutation", name => {
    const { v, target, kwargs, call } = fixture();
    if (name !== "update") expect(() => call(name, [v.true, v.false])).toThrow(name === "clear" || name === "pop" ? `set.${name}() takes no arguments (2 given)` : `set.${name}() takes exactly one argument (2 given)`);
    kwargs.items.set(v.string("x"), v.true);
    expect(() => call(name, [v.list([v.true])])).toThrow(`set.${name}() takes no keyword arguments`);
    expect(target.items.size).toBe(0);
  });

  it("executes bound mutations through compiled program calls", () => {
    const { meter, v, keys } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw new Error("unexpected hook"); };
    const hooks: RuntimeProgramHooks = {
      expressions: () => ({ attribute(receiver, name) {
        if (receiver.kind === "set" && (name === "add" || name === "remove" || name === "discard" || name === "pop" || name === "clear" || name === "update")) return createRuntimeSetMutationMethod(receiver, name, v, meter);
        return unused();
      }, beginSet: initial => beginRuntimeSet(initial, v, keys, meter), warn: unused }),
      statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: unused, keywordName: unused
    };
    const source = "s = {1, 2}\nalias = s\ns.add(3)\ns.discard(9)\ns.remove(2)\ns.update([4], {5})\ncorrect = s == {1, 3, 4, 5}\ns.clear()\ns.update({42})\npopped = s.pop()\nsame = alias is s\nempty = not s\n";
    const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { globals, builtins: new Map(), values: v, keys, calls: new CallStack<object>(10, meter), hooks }, meter);
    expect(globals.get("correct")).toBe(v.true); expect(globals.get("same")).toBe(v.true); expect(globals.get("empty")).toBe(v.true);
    expect(globals.get("popped")).toEqual(v.integer(42));
  });
});
