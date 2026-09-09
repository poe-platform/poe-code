import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeIndex } from "./runtime-index.js";
import { createLenBuiltin } from "./builtin-len.js";
import { beginRuntimeSet, constructRuntimeSet, updateRuntimeSet } from "./runtime-set.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 3000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const set = (items: RuntimeValue[] = []) => constructRuntimeSet([v.list(items)], dictionary(), v, keys, meter);
  return { meter, v, hash, keys, dictionary, set };
}

describe("concrete mutable set runtime", () => {
  it("deduplicates by Python hash/equality, retains first members and has live size/truth", () => {
    const { meter, v, set, dictionary } = fixture(), one = v.integer(1), source = set([one, v.true, v.string("x")]);
    expect(Object.isFrozen(source)).toBe(true); expect(source.items.size).toBe(2);
    expect(source.items.snapshot()[0][0]).toBe(one);
    expect(runtimeMembership("in", v.true, source, v, meter)).toBe(v.true);
    expect(createLenBuiltin(v, meter).value.invoke([source], dictionary(), meter)).toEqual(v.integer(2));
    expect(runtimeTruth(source, meter)).toBe(true); source.items.clear(); expect(runtimeTruth(source, meter)).toBe(false);
  });
  it("shares exact source hashes and discards dictionary values during updates", () => {
    const { meter, v } = fixture(); let hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => a === b }, map = new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter);
    map.set(v.true, v.integer(8)); const dictionary = v.dictionary(map), target = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); hashes = 0;
    updateRuntimeSet(target, dictionary, v, meter); expect(hashes).toBe(0); expect(target.items.snapshot()).toEqual([[v.true, v.none]]);
    const other = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); updateRuntimeSet(other, target, v, meter); expect(hashes).toBe(0);
  });
  it("does no hashing or equality work for self updates and reuses comparison hashes", () => {
    const { meter, v } = fixture(); let forbidden = false, hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => { if (forbidden) throw new Error("unexpected comparison"); return a === b; } };
    const source = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); source.items.set(v.true, v.none); source.items.set(v.false, v.none);
    forbidden = true; hashes = 0; updateRuntimeSet(source, source, v, meter); expect(hashes).toBe(0);
    forbidden = false; const other = v.set(source.items.copy()); hashes = 0;
    expect(runtimeComparison("==", source, other, v, meter)).toBe(v.true); expect(hashes).toBe(0);
  });
  it("compares equal/proper subsets and supersets independent of insertion order", () => {
    const { meter, v, set } = fixture(), a = set([v.integer(1), v.integer(2)]), b = set([v.integer(2), v.true]), c = set([v.integer(1)]);
    expect(runtimeComparison("==", a, b, v, meter)).toBe(v.true);
    expect(runtimeComparison("!=", a, b, v, meter)).toBe(v.false);
    expect(runtimeComparison("<", c, a, v, meter)).toBe(v.true);
    expect(runtimeComparison(">", a, c, v, meter)).toBe(v.true);
    expect(runtimeComparison("<=", a, b, v, meter)).toBe(v.true);
    expect(runtimeComparison(">=", c, a, v, meter)).toBe(v.false);
    expect(runtimeComparison("==", a, v.list([v.integer(1), v.integer(2)]), v, meter)).toBe(v.false);
  });
  it("interoperates with set-like dictionary views in comparisons and disjointness", () => {
    const { meter, v, set, dictionary } = fixture(), d = dictionary(); d.items.set(v.true, v.false);
    const keys = v.dictionaryView(d, "dict_keys"), items = v.dictionaryView(d, "dict_items");
    expect(runtimeComparison("==", set([v.integer(1)]), keys, v, meter)).toBe(v.true);
    expect(runtimeComparison("<=", items, set([v.tuple([v.true, v.false])]), v, meter)).toBe(v.true);
    expect(runtimeComparison(">", set([v.true, v.false]), keys, v, meter)).toBe(v.true);
    d.items.set(v.true, v.list([]));
    expect(() => runtimeComparison("==", set([v.integer(1)]), items, v, meter)).toThrow("cannot use 'tuple' as a set element");
    let forbidden = false;
    const ops = { hash() { if (forbidden) throw new Error("unexpected hash"); return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => a === b };
    const empty = v.dictionaryView(v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(ops, meter)), "dict_keys"), other = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(ops, meter)); other.items.set(v.true, v.none);
    const method = readRuntimeDictionaryViewAttribute(empty, "isdisjoint", v, meter); if (method?.kind !== "builtin_function_or_method") throw new Error("expected method");
    forbidden = true; expect(method.value.invoke([other], dictionary(), meter)).toBe(v.true);
  });
  it("rejects unhashable elements and preserves partial updates and iterator position", () => {
    const { meter, v, set, hash } = fixture(), target = set(), iterator = v.iterator(runtimeIterate(v.list([v.true, v.list([]), v.false]), v, meter));
    expect(() => updateRuntimeSet(target, iterator, v, meter)).toThrow("cannot use 'list' as a set element");
    expect(target.items.size).toBe(1); expect(iterator.value.next().value).toBe(v.false);
    expect(() => runtimeMembership("in", v.list([]), target, v, meter)).toThrow("cannot use 'list' as a set element");
    expect(() => runtimeHash(target, hash, meter)).toThrow("unhashable type: 'set'");
    expect(() => runtimeIndex(target, v.integer(0), v, meter)).toThrow("'set' object is not subscriptable");
  });
  it("latches set-specific size errors and does not revive exhausted iterators", () => {
    const { meter, v, set } = fixture(), source = set([v.true]), iterator = runtimeIterate(source, v, meter);
    source.items.set(v.false, v.none); expect(() => iterator.next()).toThrow("Set changed size during iteration");
    source.items.delete(v.false); expect(() => iterator.next()).toThrow("Set changed size during iteration");
    const empty = set(), done = runtimeIterate(empty, v, meter); expect(done.next().done).toBe(true);
    empty.items.set(v.true, v.none); expect(done.next().done).toBe(true);
  });
  it("supports literal builders and constructor argument validation", () => {
    const { meter, v, keys, dictionary } = fixture(), builder = beginRuntimeSet([v.true], v, keys, meter);
    builder.update(v.list([v.false, v.true])); builder.add(v.none);
    const result = builder.finish(); expect(result.kind).toBe("set");
    expect(runtimeMembership("in", v.none, result, v, meter)).toBe(v.true);
    expect(constructRuntimeSet([], dictionary(), v, keys, meter).items.size).toBe(0);
    expect(() => constructRuntimeSet([v.none, v.none], dictionary(), v, keys, meter)).toThrow("set expected at most 1 argument, got 2");
    const kwargs = dictionary(); kwargs.items.set(v.string("iterable"), v.none);
    expect(() => constructRuntimeSet([], kwargs, v, keys, meter)).toThrow("set() takes no keyword arguments");
  });
  it("executes set displays, starred inputs, loops and comparisons in programs", () => {
    const { meter, v, keys } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw new Error("unexpected hook"); };
    const hooks: RuntimeProgramHooks = { expressions: () => ({ attribute: unused, beginSet: initial => beginRuntimeSet(initial, v, keys, meter), warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: unused, keywordName: unused };
    const program = compileProgram<RuntimeValue>(analyzeModule("a = {1, 2, 1}\nb = {*a, 3}\nsame = a == {2, 1}\nsmaller = a < b\ntotal = 0\nfor value in b:\n    total += value\n"), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { globals, builtins: new Map(), values: v, keys, calls: new CallStack<object>(10, meter), hooks }, meter);
    expect(globals.get("same")).toBe(v.true); expect(globals.get("smaller")).toBe(v.true); expect(globals.get("total")).toEqual(v.integer(6));
  });
});
