import { expect, it } from "vitest";
import { complexFormat } from "./complex-format.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";
import { renderComplexFormatBuffer } from "./complex-format-field.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const points = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
it("dispatches complex specs and adopts the composed buffer without copying", () => {
  expect([...complexFormat(1, 2, points(".2f"), "complex", budget())]).toEqual([...points("1.00+2.00j")]);
  const direct = budget(), wrapped = budget(), field = parseFormatSpec(points("*^20.2f"), 0, ">", "complex", budget());
  const output = renderComplexFormatBuffer(1, 2, field, direct);
  expect([...CodePointString.fromComplexFormat(1, 2, field, wrapped)]).toEqual([...output]);
  expect(wrapped.usage.allocatedBytes).toBe(direct.usage.allocatedBytes);
});
it("rejects unsupported complex presentations before layout checks", () => {
  expect(() => complexFormat(1, 2, points("0.2147483648%"), "complex", budget())).toThrow("Unknown format code '%' for object of type 'complex'");
  expect(() => complexFormat(1, 2, points("😀"), "complex", budget())).toThrow("Unknown format code '\\x1f600' for object of type 'complex'");
  expect(() => complexFormat(1, 2, points("0.2147483648f"), "complex", budget())).toThrow("precision too big");
});
