import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { beginRuntimeSet } from "./runtime-set.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  let hashes = 0;
  const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const set = (...members: RuntimeValue[]) => {
    const result = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    for (const key of members) result.items.set(key, v.none);
    return result;
  };
  return { meter, v, keys, set, hashes: () => hashes };
}

describe("exact mutable-set difference", () => {
  it("returns fresh left-only members without rehashing or modifying operands", () => {
    const { meter, v, set, hashes } = fixture(), retained = v.integer(2), a = set(v.true, retained), b = set(v.integer(1), v.integer(3)), before = hashes();
    const result = runtimeBinary("-", a, b, v, meter);
    expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set");
    expect(result).not.toBe(a); expect(result.items.snapshot()).toEqual([[retained, v.none]]);
    expect(result.items.snapshot()[0][0]).toBe(retained); expect(hashes()).toBe(before);
    expect(a.items.size).toBe(2); expect(b.items.size).toBe(2);
  });

  it("subtracts in place, retaining receiver identity and invalidating size-changed iterators", () => {
    const { meter, v, set, hashes } = fixture(), a = set(v.true, v.false), b = set(v.integer(1)), before = hashes(), storage = a.items;
    const iterator = storage.iterate(key => key, "set");
    expect(runtimeInPlace("-", a, b, v, meter)).toBe(a); expect(a.items).toBe(storage);
    expect(storage.snapshot()).toEqual([[v.false, v.none]]); expect(hashes()).toBe(before);
    expect(() => iterator.next()).toThrow("Set changed size during iteration");
  });

  it("clears self subtraction without invoking guest comparisons", () => {
    const { meter, v } = fixture(); let forbidden = false;
    const keys = { hash: () => 1n, equal: () => { if (forbidden) throw new Error("unexpected comparison"); return false; } };
    const a = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); a.items.set(v.true, v.none); a.items.set(v.false, v.none); forbidden = true;
    expect(runtimeInPlace("-", a, a, v, meter)).toBe(a); expect(a.items.size).toBe(0);
  });

  it("retains completed removals when a later equality call fails", () => {
    const { meter, v } = fixture(); let fail = false;
    const keys = { hash: (key: RuntimeValue) => key === v.true ? 1n : 2n, equal: () => { if (fail) throw new Error("comparison failed"); return false; } };
    const a = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), b = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    a.items.set(v.true, v.none); a.items.set(v.false, v.none); b.items.set(v.true, v.none); b.items.set(v.integer(0), v.none); fail = true;
    expect(() => runtimeInPlace("-", a, b, v, meter)).toThrow("comparison failed");
    expect(a.items.snapshot()).toEqual([[v.false, v.none]]);
  });

  it("does not consume unsupported iterable operands", () => {
    const { meter, v, set } = fixture(), a = set(v.true), iterator = v.iterator([v.true][Symbol.iterator]());
    expect(runtimeBinary("-", a, iterator, v, meter)).toBe(v.notImplemented);
    expect(runtimeInPlace("-", a, iterator, v, meter)).toBe(v.notImplemented);
    expect(iterator.value.next().value).toBe(v.true); expect(a.items.size).toBe(1);
  });

  it("executes every binary and augmented set operator through compiled programs", () => {
    const { meter, v, keys, set } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw new Error("unexpected hook"); };
    const hooks: RuntimeProgramHooks = { expressions: () => ({ attribute: unused, beginSet: initial => beginRuntimeSet(initial, v, keys, meter), warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: unused, keywordName: unused };
    const source = "a = {1, 2}\nb = {2, 3}\nunion = a | b\nintersection = a & b\ndifference = a - b\nxor = a ^ b\nalias = a\na |= b\na -= {2}\na ^= {3, 4}\na &= {1, 4, 5}\nsame = a is alias\n";
    const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { globals, builtins: new Map(), values: v, keys, calls: new CallStack<object>(10, meter), hooks }, meter);
    const expected = { union: [1, 2, 3], intersection: [2], difference: [1], xor: [1, 3], a: [1, 4] };
    for (const [name, members] of Object.entries(expected)) expect(runtimeComparison("==", globals.get(name)!, set(...members.map(n => v.integer(n))), v, meter)).toBe(v.true);
    expect(globals.get("same")).toBe(v.true);
  });
});
