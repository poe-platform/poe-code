import { describe, expect, it } from "vitest";
import { rangeHash } from "./range-hash.js";
import { createRange } from "./integer-sequence.js";
import { ConstantValues } from "./constant-values.js";
import { constantHash, type ConstantHashContext } from "./constant-hash.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const values = new ConstantValues(meter);
  const context: ConstantHashContext = { identity: () => 17n, string: () => { throw new Error("unexpected string hash"); }, bytes: () => { throw new Error("unexpected bytes hash"); } };
  return { meter, values, context };
}

describe("range hashing", () => {
  it("hashes empty ranges independently of all attributes", () => {
    const { meter, values: v, context } = fixture();
    const expected = constantHash(v.tuple([v.integer(0n), v.none, v.none]), context, meter);
    for (const range of [createRange(0n, 0n), createRange(8n, 2n), createRange(-9n, 1n, -2n)]) expect(rangeHash(range, v, context, meter)).toBe(expected);
  });
  it("ignores stop and step for singleton ranges", () => {
    const { meter, values: v, context } = fixture();
    const expected = constantHash(v.tuple([v.integer(1n), v.integer(3n), v.none]), context, meter);
    expect(rangeHash(createRange(3n, 4n), v, context, meter)).toBe(expected);
    expect(rangeHash(createRange(3n, -1n, -9n), v, context, meter)).toBe(expected);
  });
  it("uses length, start and step for longer ranges", () => {
    const { meter, values: v, context } = fixture();
    const expected = constantHash(v.tuple([v.integer(3n), v.integer(2n), v.integer(3n)]), context, meter);
    expect(rangeHash(createRange(2n, 9n, 3n), v, context, meter)).toBe(expected);
    expect(rangeHash(createRange(2n, 11n, 3n), v, context, meter)).toBe(expected);
  });
  it("hashes huge cardinalities without iteration or length overflow", () => {
    const { meter, values: v, context } = fixture(), end = 1n << 1000n;
    expect(rangeHash(createRange(0n, end), v, context, meter)).toBe(constantHash(v.tuple([v.integer(end), v.integer(0n), v.integer(1n)]), context, meter));
    expect(meter.usage.steps).toBeLessThan(100);
  });
  it("matches CPython's fixed hashes without identity callbacks for missing fields", () => {
    const { meter, values: v, context } = fixture(), seen: unknown[] = [];
    const ctx = { ...context, identity: (value: unknown) => { seen.push(value); return 17n; } };
    expect(rangeHash(createRange(0n, 0n), v, ctx, meter)).toBe(2676694398852732306n);
    expect(rangeHash(createRange(1n, 2n), v, ctx, meter)).toBe(-1269592299258668772n);
    expect(rangeHash(createRange(0n, 3n), v, ctx, meter)).toBe(-8338477496398685190n);
    expect(seen).toEqual([]);
  });
  it("does not require an identity service to hash ranges", () => {
    const { meter, values: v, context } = fixture(), failure = new Error("identity failed");
    expect(rangeHash(createRange(0n, 0n), v, { ...context, identity: () => { throw failure; } }, meter)).toBe(2676694398852732306n);
  });
  it("checks entry limits before constructing the hash key", () => {
    const { values: v, context } = fixture();
    expect(() => rangeHash(createRange(0n, 3n), v, context, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
