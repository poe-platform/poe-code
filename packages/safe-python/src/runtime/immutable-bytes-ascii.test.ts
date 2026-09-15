import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it("copies ASCII code points without UTF-16 conversion, including controls", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), points = Uint32Array.from({ length: 128 }, (_, i) => i);
  expect([...ImmutableBytes.fromAscii(new CodePointString(points, meter), meter)]).toEqual([...points]);
  expect(ImmutableBytes.fromAscii(new CodePointString(new Uint32Array(), meter), meter).length).toBe(0);
});
it("rejects non-ASCII trusted input and charges allocation before copying", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
  for (const point of [128, 255, 0xd800, 0x1f600]) expect(() => ImmutableBytes.fromAscii(new CodePointString(Uint32Array.of(point), meter), meter)).toThrow("expected ASCII code points");
  const source = new CodePointString(Uint32Array.of(65, 66), meter);
  expect(() => ImmutableBytes.fromAscii(source, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1 }))).toThrow(ExecutionLimitError);
});
