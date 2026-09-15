import { expect, it } from "vitest";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { constantIndex } from "./constant-index.js";
import { constantSlice } from "./constant-slice.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  return { meter, v };
}
it("shares Latin-1 indexed and iterated characters with the runtime cache", () => {
  const { meter, v } = fixture();
  for (let point = 0; point < 256; point++) {
    const char = v.string(String.fromCodePoint(point)), source = v.stringPoints(Uint32Array.of(33, point, 63));
    expect(constantIndex(source, v.integer(1), v, meter)).toBe(char);
    expect(runtimeIndex(source, v.integer(-2), v, meter)).toBe(char);
    const cursor = runtimeIterate(source, v, meter); cursor.next();
    expect(cursor.next().value).toBe(char);
  }
});
it("canonicalizes contiguous single-character slices but retains fresh strided results", () => {
  const { meter, v } = fixture(), source = v.string("!é?"), char = v.string("é");
  for (const step of [1, 2, -1]) {
    const lower = v.integer(1), upper = v.integer(step < 0 ? 0 : 2), stride = v.integer(step);
    const constant = constantSlice(source, { lower, upper, step: stride }, v, meter);
    const runtime = runtimeIndex(source, v.slice({ lower, upper, step: stride }), v, meter);
    expect(constant).toEqual(char); expect(runtime).toEqual(char);
    expect(constant === char).toBe(step === 1);
    expect(runtime === char).toBe(step === 1);
  }
});
it("preserves full-slice identity even for a fresh Latin-1 source", () => {
  const { meter, v } = fixture(), cached = v.string("a"), source = v.stringPoints(cached.value, "fresh");
  expect(constantSlice(source, {}, v, meter)).toBe(source);
  expect(runtimeIndex(source, v.slice({}), v, meter)).toBe(source);
  expect(constantIndex(source, v.integer(0), v, meter)).toBe(cached);
});
it("keeps non-Latin-1 character results fresh and canonicalizes empty slices", () => {
  const { meter, v } = fixture();
  for (const text of ["Ā", "😀", "\ud800"]) {
    const source = v.string("!" + text + "?"), char = v.string(text);
    const result = runtimeIndex(source, v.integer(1), v, meter);
    expect(result).toEqual(char); expect(result).not.toBe(char);
    expect(runtimeIndex(source, v.integer(1), v, meter)).not.toBe(result);
  }
  const source = v.string("abc");
  expect(runtimeIndex(source, v.slice({ lower: v.integer(2), upper: v.integer(1), step: v.integer(2) }), v, meter)).toBe(v.string(""));
});
