import { describe, expect, it } from "vitest";
import { ConstantValues, type ConstantValue } from "./constant-values.js";
import { constantHash, type ConstantHashContext } from "./constant-hash.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 10000000 });
  const context: ConstantHashContext = { identity: () => 17n, string: () => 23n, bytes: () => 29n };
  return { meter, values: new ConstantValues(meter), context };
}

describe("concrete immutable hashing", () => {
  it("uses CPython's fixed None hash without invoking the identity policy", () => {
    const { meter, values: v, context } = fixture();
    expect(constantHash(v.none, { ...context, identity() { throw Error("unexpected identity hash"); } }, meter)).toBe(0xfca86420n);
  });
  it("gives equal numeric values identical hashes across numeric kinds", () => {
    const { meter, values: v, context } = fixture();
    for (const value of [v.true, v.integer(1), v.float(1), v.complex(1, 0)]) expect(constantHash(value, context, meter)).toBe(1n);
    for (const value of [v.false, v.integer(0), v.float(-0), v.complex(-0, 0)]) expect(constantHash(value, context, meter)).toBe(0n);
    expect(constantHash(v.complex(1, 2), context, meter)).toBe(2000007n);
    expect(constantHash(v.integer(-1), context, meter)).toBe(-2n);
  });
  it("hashes tuples and slices using their distinct 64-bit combiners", () => {
    const { meter, values: v, context } = fixture();
    expect(constantHash(v.tuple([]), context, meter)).toBe(5740354900026072187n);
    expect(constantHash(v.tuple([v.integer(1), v.integer(2)]), context, meter)).toBe(-3550055125485641917n);
    expect(constantHash(v.slice({ lower: v.integer(1), upper: v.integer(2), step: v.integer(3) }), context, meter)).toBe(-2340833382717974474n);
  });
  it("delegates seeded payload and identity hashes without exporting mutable storage", () => {
    const { meter, values: v } = fixture(), seen: unknown[] = [];
    const context: ConstantHashContext = {
      identity: value => { seen.push(value); return 17n; },
      string: (value, activeMeter) => { expect(activeMeter).toBe(meter); seen.push(value); return 23n; },
      bytes: (value, activeMeter) => { expect(activeMeter).toBe(meter); seen.push(value); return 29n; }
    };
    const text = v.string("x"), bytes = v.bytes(Uint8Array.of(1)), nan = v.float(NaN), complex = v.complex(NaN, NaN);
    expect(constantHash(text, context, meter)).toBe(23n); expect(constantHash(bytes, context, meter)).toBe(29n);
    expect(constantHash(nan, context, meter)).toBe(17n);
    expect(constantHash(complex, context, meter)).toBe(17000068n);
    expect(seen).toEqual([text.value, bytes.value, nan, complex, complex]);
  });
  it("normalizes host hash width and the reserved minus-one result", () => {
    const { meter, values: v, context } = fixture();
    expect(constantHash(v.ellipsis, { ...context, identity: () => -1n }, meter)).toBe(-2n);
    expect(constantHash(v.string("x"), { ...context, string: () => (1n << 64n) + 3n }, meter)).toBe(3n);
  });
  it("walks deeply nested immutable containers without host recursion", () => {
    const { meter, values: v, context } = fixture();
    let value: ConstantValue = v.true;
    for (let i = 0; i < 10000; i++) value = v.tuple([value]);
    expect(typeof constantHash(value, context, meter)).toBe("bigint");
  });
  it("stops before later members when a payload hash fails", () => {
    const { meter, values: v, context } = fixture(), error = new Error("hash failed"), calls: string[] = [];
    expect(() => constantHash(v.tuple([v.string("x"), v.bytes(new Uint8Array())]), {
      ...context, string: () => { calls.push("string"); throw error; }, bytes: () => { calls.push("bytes"); return 0n; }
    }, meter)).toThrow(error);
    expect(calls).toEqual(["string"]);
  });
  it("checks entry and reserves stack frames before descending", () => {
    const { values: v, context } = fixture();
    expect(() => constantHash(v.none, context, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => constantHash(v.tuple([v.true]), context, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("observes cancellation by a trusted policy before publishing its result", () => {
    const { values: v, context } = fixture(), controller = new AbortController();
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => constantHash(v.ellipsis, { ...context, identity: () => { controller.abort(); return 1n; } }, meter)).toThrow(ExecutionLimitError);
  });
});
