import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { updateRuntimeSet } from "./runtime-set.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  let hashes = 0;
  const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const set = (...members: RuntimeValue[]) => {
    const result = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    for (const key of members) result.items.set(key, v.none);
    return result;
  };
  return { meter, v, set, hashes: () => hashes };
}

describe("exact set union and symmetric difference", () => {
  it.each(["|", "^"])("implements fresh binary %s with cached hashes", operator => {
    const { meter, v, set, hashes } = fixture(), one = v.integer(1), a = set(one, v.integer(2)), b = set(v.true, v.integer(3)), before = hashes();
    const result = runtimeBinary(operator, a, b, v, meter);
    expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set");
    expect(result).not.toBe(a); expect(result).not.toBe(b); expect(hashes()).toBe(before);
    expect(runtimeComparison("==", result, operator === "|" ? set(v.true, v.integer(2), v.integer(3)) : set(v.integer(2), v.integer(3)), v, meter)).toBe(v.true);
    if (operator === "|") expect(result.items.snapshot()[0][0]).toBe(one);
    result.items.clear(); expect(a.items.size).toBe(2); expect(b.items.size).toBe(2);
  });

  it.each(["|", "^"])("mutates the receiver for %s= and preserves the other operand", operator => {
    const { meter, v, set, hashes } = fixture(), a = set(v.true, v.integer(2)), b = set(v.integer(1), v.integer(3)), before = hashes(), storage = a.items;
    expect(runtimeInPlace(operator, a, b, v, meter)).toBe(a);
    expect(a.items).toBe(storage); expect(hashes()).toBe(before); expect(b.items.size).toBe(2);
    expect(a.items.size).toBe(operator === "|" ? 3 : 2);
  });

  it("handles self union without comparisons and self xor by clearing", () => {
    const { meter, v } = fixture(); let forbidden = false;
    const keys = { hash: () => 1n, equal: () => { if (forbidden) throw new Error("unexpected equality"); return false; } };
    const a = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); a.items.set(v.true, v.none); a.items.set(v.false, v.none);
    const iterator = a.items.iterate(key => key, "set"); expect(iterator.next().value).toBe(v.true); forbidden = true;
    const copy = runtimeBinary("|", a, a, v, meter); expect(copy.kind).toBe("set"); expect(copy).not.toBe(a);
    expect(runtimeInPlace("|", a, a, v, meter)).toBe(a); expect(iterator.next().value).toBe(v.false);
    expect(runtimeInPlace("^", a, a, v, meter)).toBe(a); expect(a.items.size).toBe(0);
  });

  it("copies exact set updates into empty sets without re-comparing collisions", () => {
    const { meter, v } = fixture(); let forbidden = false;
    const keys = { hash: () => 1n, equal: () => { if (forbidden) throw new Error("unexpected equality"); return false; } };
    const source = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), target = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    source.items.set(v.true, v.none); source.items.set(v.false, v.none); forbidden = true;
    updateRuntimeSet(target, source, v, meter); expect(target.items.size).toBe(2);
  });

  it.each(["|", "^"])("declines %s with iterable non-set operands", operator => {
    const { meter, v, set } = fixture(), source = set(v.true), other = v.iterator([v.false][Symbol.iterator]());
    expect(runtimeInPlace(operator, source, other, v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary(operator, other, source, v, meter)).toBe(v.notImplemented);
    expect(other.value.next().value).toBe(v.false); expect(source.items.size).toBe(1);
  });

  it.each(["|", "^"])("keeps earlier in-place %s mutations when a later comparison fails", operator => {
    const { meter, v } = fixture(); let fail = false;
    const keys = { hash: (key: RuntimeValue) => key === v.false ? 2n : 1n, equal: () => { if (fail) throw new Error("equality failed"); return false; } };
    const a = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), b = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    a.items.set(v.true, v.none); b.items.set(v.false, v.none); b.items.set(v.integer(9), v.none); fail = true;
    expect(() => runtimeInPlace(operator, a, b, v, meter)).toThrow("equality failed");
    expect(a.items.size).toBe(2); expect(a.items.snapshot().map(([key]) => key)).toEqual([v.true, v.false]);
  });
});
