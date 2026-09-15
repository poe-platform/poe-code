import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const text = (points: number[]) => new CodePointString(Uint32Array.from(points));
it("returns unchanged ASCII storage including controls, quotes and backslashes", () => {
  const source = text(Array.from({ length: 128 }, (_, index) => index));
  expect(source.escapeAscii(budget())).toBe(source);
  const empty = text([]); expect(empty.escapeAscii(budget())).toBe(empty);
});
it("escapes non-ASCII points with lowercase x, u and U hex forms", () => {
  const source = text([65, 128, 255, 256, 0xffff, 0x10000, 0x10ffff, 90]);
  expect(String.fromCodePoint(...source.escapeAscii(budget()))).toBe("A\\x80\\xff\\u0100\\uffff\\U00010000\\U0010ffffZ");
});
it("keeps ASCII controls and escape syntax literal in mixed input", () => {
  const source = text([39, 10, 92, 120, 233, 0, 127]);
  expect(String.fromCodePoint(...source.escapeAscii(budget()))).toBe("'\n\\x\\xe9\0\x7f");
});
it("does not combine adjacent surrogate code points", () => {
  expect(String.fromCodePoint(...text([0xd800, 0xdc00, 0x10000]).escapeAscii(budget()))).toBe("\\ud800\\udc00\\U00010000");
});
it("adopts a single exact-sized result buffer", () => {
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 16 });
  const result = text([233]).escapeAscii(meter);
  expect(result.length).toBe(4); expect(meter.usage.allocatedBytes).toBe(16);
  expect(Object.isFrozen(result)).toBe(true);
});
it("rejects output allocation and observes scan cancellation", () => {
  expect(() => text([233]).escapeAscii(new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 15 }))).toThrow(ExecutionLimitError);
  const controller = new AbortController(); controller.abort();
  expect(() => text([65]).escapeAscii(new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => text(Array(100).fill(65)).escapeAscii(new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
