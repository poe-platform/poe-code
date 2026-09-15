import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const operations = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = (...entries: [RuntimeValue, RuntimeValue][]) => {
    const result = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(operations, meter));
    for (const [key, value] of entries) result.items.set(key, value);
    return result;
  };
  return { meter, v, dictionary, compare: (op: string, a: RuntimeValue, b: RuntimeValue, depth = 1000) => runtimeComparison(op, a, b, v, meter, depth).value };
}

describe("runtime dictionary equality", () => {
  it("ignores insertion order and uses numeric-equivalent keys", () => {
    const { v, dictionary: d, compare } = fixture();
    const a = d([v.integer(1), v.list([v.integer(2)])], [v.string("x"), v.none]);
    const b = d([v.string("x"), v.none], [v.true, v.list([v.float(2)])]);
    expect(compare("==", a, b)).toBe(true); expect(compare("!=", a, b)).toBe(false);
    b.items.set(v.true, v.integer(2)); expect(compare("==", a, b)).toBe(false); expect(compare("!=", a, b)).toBe(true);
  });
  it("rejects missing keys and different sizes", () => {
    const { v, dictionary: d, compare } = fixture();
    expect(compare("==", d(), d())).toBe(true);
    expect(compare("==", d([v.integer(1), v.none]), d())).toBe(false);
    expect(compare("==", d([v.integer(1), v.none]), d([v.integer(2), v.none]))).toBe(false);
  });
  it("skips identical values, including NaN and self cycles", () => {
    const { v, dictionary: d, compare } = fixture(), nan = v.float(NaN);
    expect(compare("==", d([v.true, nan]), d([v.true, nan]))).toBe(true);
    expect(compare("==", d([v.true, nan]), d([v.true, v.float(NaN)]))).toBe(false);
    const a = d(); a.items.set(v.true, a); expect(compare("==", a, a)).toBe(true);
  });
  it("bounds distinct cyclic comparisons without host stack overflow", () => {
    const { v, dictionary: d, compare } = fixture(), a = d(), b = d();
    a.items.set(v.true, a); b.items.set(v.true, b);
    expect(() => compare("==", a, b, 20)).toThrow("maximum recursion depth exceeded in comparison");
  });
  it("compares deeply nested dictionaries and mixed containers iteratively", () => {
    const { v, dictionary: d, compare } = fixture();
    let a: RuntimeValue = v.integer(1), b: RuntimeValue = v.float(1);
    for (let i = 0; i < 4000; i++) { a = d([v.true, v.tuple([a])]); b = d([v.true, v.tuple([b])]); }
    expect(compare("==", a, b, 9000)).toBe(true);
  });
  it("does not order dictionaries or equate them with sequences", () => {
    const { v, dictionary: d, compare } = fixture();
    expect(compare("==", d(), v.list([]))).toBe(false);
    for (const op of ["<", "<=", ">", ">="]) expect(() => compare(op, d(), d())).toThrow(`'${op}' not supported between instances of 'dict' and 'dict'`);
  });
});
