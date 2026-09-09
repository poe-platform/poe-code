import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

describe("exact set intersection", () => {
  function fixture() {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const v = new RuntimeValues(meter);
    let hashes = 0, comparisons = 0, fail = false;
    const keys = {
      hash: () => { hashes++; return 1n; },
      equal: (a: RuntimeValue, b: RuntimeValue) => {
        comparisons++;
        if (fail) throw new Error("comparison failed");
        return (a.kind === "int" ? a.value : a.kind === "bool" ? BigInt(a.value) : a) === (b.kind === "int" ? b.value : b.kind === "bool" ? BigInt(b.value) : b);
      }
    };
    const set = (...members: RuntimeValue[]) => {
      const result = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
      for (const member of members) result.items.set(member, v.none);
      return result;
    };
    return { meter, v, set, counts: () => ({ hashes, comparisons }), fail: () => { fail = true; } };
  }

  it("returns fresh storage, choosing right-hand members for equal sizes", () => {
    const { meter, v, set, counts } = fixture(), one = v.integer(1), a = set(one), b = set(v.true), before = counts();
    const result = runtimeBinary("&", a, b, v, meter);
    expect(result.kind).toBe("set");
    if (result.kind !== "set") throw new Error("expected set");
    expect(result).not.toBe(a); expect(result).not.toBe(b);
    expect(result.items.snapshot()[0][0]).toBe(v.true);
    expect(counts().hashes).toBe(before.hashes);
    result.items.clear(); expect(a.items.size).toBe(1); expect(b.items.size).toBe(1);
  });

  it("chooses the smaller operand and excludes unmatched members", () => {
    const { meter, v, set } = fixture(), one = v.integer(1), a = set(one), b = set(v.true, v.false);
    for (const [left, right] of [[a, b], [b, a]]) {
      const result = runtimeBinary("&", left, right, v, meter);
      expect(result.kind).toBe("set");
      if (result.kind !== "set") throw new Error("expected set");
      expect(result.items.snapshot()).toEqual([[one, v.none]]);
      expect(result.items.snapshot()[0][0]).toBe(one);
    }
  });

  it("copies self intersections without calling guest hash or equality", () => {
    const { meter, v, set, counts, fail } = fixture(), source = set(v.true, v.false), before = counts();
    fail(); const result = runtimeBinary("&", source, source, v, meter);
    expect(result.kind).toBe("set"); expect(result).not.toBe(source); expect(counts()).toEqual(before);
  });

  it("propagates comparison failures without altering either operand", () => {
    const { meter, v, set, fail } = fixture(), a = set(v.integer(1)), b = set(v.true);
    fail(); expect(() => runtimeBinary("&", a, b, v, meter)).toThrow("comparison failed");
    expect(a.items.size).toBe(1); expect(b.items.size).toBe(1);
  });

  it("declines non-set operands without consuming iterable inputs", () => {
    const { meter, v, set } = fixture(), source = set(v.true), iterator = v.iterator([v.true][Symbol.iterator]());
    expect(runtimeBinary("&", source, iterator, v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("&", v.list([v.true]), source, v, meter)).toBe(v.notImplemented);
    expect(iterator.value.next().value).toBe(v.true);
  });

  it("updates in place while keeping the set and storage identities", () => {
    const { meter, v, set } = fixture(), source = set(v.integer(1), v.integer(2)), other = set(v.true), storage = source.items;
    const iterator = source.items.iterate(key => key, "set");
    expect(runtimeInPlace("&", source, other, v, meter)).toBe(source);
    expect(source.items).toBe(storage); expect(storage.snapshot()).toEqual([[v.true, v.none]]);
    expect(() => iterator.next()).toThrow("Set changed size during iteration");
    expect(other.items.size).toBe(1);
  });

  it("does not publish partial in-place intersections when equality fails", () => {
    const { meter, v, set, fail } = fixture(), source = set(v.integer(1), v.false), other = set(v.true);
    fail(); expect(() => runtimeInPlace("&", source, other, v, meter)).toThrow("comparison failed");
    expect(source.items.size).toBe(2);
  });

  it("does not restart a live iterator during self intersection", () => {
    const { meter, v, set } = fixture(), source = set(v.true, v.false), iterator = source.items.iterate(key => key, "set");
    expect(iterator.next().value).toBe(v.true);
    expect(runtimeInPlace("&", source, source, v, meter)).toBe(source);
    expect(iterator.next().value).toBe(v.false); expect(iterator.next().done).toBe(true);
  });
});
