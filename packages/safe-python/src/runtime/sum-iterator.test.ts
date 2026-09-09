import { expect, it } from "vitest";
import { sumIterator } from "./sum-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeBinary } from "./runtime-binary.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const add = (a: RuntimeValue, b: RuntimeValue) => runtimeBinary("+", a, b, v, meter);
  const sum = (items: RuntimeValue[], start: RuntimeValue = v.integer(0)) => sumIterator(items.values(), start, v, add, meter);
  return { meter, v, add, sum };
}
it("accumulates integers and transitions to compensated floating and complex sums", () => {
  const { v, sum } = fixture();
  expect(sum([v.true, v.integer(2), v.false])).toBe(v.integer(3));
  expect(sum([v.float(1e16), v.float(1), v.float(-1e16)])).toEqual(v.float(1));
  expect(sum([v.complex(1e16, 1e16), v.complex(1, 1), v.complex(-1e16, -1e16)])).toEqual(v.complex(1, 1));
  expect(sum([v.float(1), v.integer(2)], v.complex(-0, -0))).toEqual(v.complex(3, -0));
});
it("does not re-enter fast phases after generic addition or integer overflow", () => {
  const { v, sum } = fixture(), items = [v.float(1e16), v.float(1), v.float(-1e16)];
  expect(sum(items, v.true)).toEqual(v.float(0));
  const boundary = 1n << 63n;
  expect(sum([v.integer(boundary), v.integer(-boundary), ...items])).toEqual(v.float(0));
  expect(sum([v.integer(-boundary), ...items], v.integer(boundary))).toEqual(v.float(0));
});
it("preserves generic empty start identity but reconstructs fast numeric starts", () => {
  const { v, sum } = fixture();
  for (const start of [v.true, v.list([]), v.integer(1n << 70n)]) expect(sum([], start)).toBe(start);
  for (const start of [v.integer(1000), v.float(-0), v.complex(0, -0)]) {
    expect(sum([], start)).toEqual(start); expect(sum([], start)).not.toBe(start);
  }
});
it("uses ordinary addition without mutating list starts and propagates guest errors", () => {
  const { v, sum, meter } = fixture(), start = v.list([v.integer(1)]);
  expect(sum([v.list([v.integer(2)])], start)).toEqual(v.list([v.integer(1), v.integer(2)]));
  expect(start.items.length).toBe(1);
  const failure = Error("guest addition failed");
  expect(() => sumIterator([v.none].values(), v.none, v, () => { throw failure; }, meter)).toThrow(failure);
});
it("converts float-phase integer inputs with overflow checks", () => {
  const { v, sum } = fixture();
  expect(() => sum([v.integer(1n << 20000n)], v.float(0))).toThrow("int too large to convert to float");
  expect(() => sum([v.integer(1n << 20000n)], v.complex(0, 0))).toThrow("int too large to convert to float");
});
it("observes cancellation after generic addition before returning", () => {
  const { v } = fixture(); let cancelled = false;
  expect(() => sumIterator([v.none].values(), v.none, v, () => { cancelled = true; return v.none; }, {
    checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); }
  })).toThrow(ExecutionLimitError);
});
