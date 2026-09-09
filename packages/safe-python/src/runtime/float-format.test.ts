import { expect, it } from "vitest";
import { floatFormat } from "./float-format.js";
import { integerFormat } from "./integer-format.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";
import { renderFloatFormatBuffer } from "./float-format-field.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const points = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
it("dispatches native float specs and adopts the final buffer without copying", () => {
  expect([...floatFormat(-0.0001, points("+z08.2f"), "float", budget())]).toEqual([...points("+0000.00")]);
  const direct = budget(), wrapped = budget(), field = parseFormatSpec(points("020,.6_f"), 0, ">", "float", budget());
  const output = renderFloatFormatBuffer(1234.56789, field, direct);
  expect([...CodePointString.fromFloatFormat(1234.56789, field, wrapped)]).toEqual([...output]);
  expect(wrapped.usage.allocatedBytes).toBe(direct.usage.allocatedBytes);
});
it("rejects unknown float presentations before precision bounds", () => {
  expect(() => floatFormat(1, points(".2147483648q"), "float", budget())).toThrow("Unknown format code 'q' for object of type 'float'");
  expect(() => floatFormat(1, points("😀"), "float", budget())).toThrow("Unknown format code '\\x1f600' for object of type 'float'");
  expect(() => floatFormat(1, points(".2147483648f"), "float", budget())).toThrow("precision too big");
});
it("formats integer float-style presentations after checked binary64 conversion", () => {
  expect([...integerFormat(123n, points(".2f"), "int", budget())]).toEqual([...points("123.00")]);
  expect([...integerFormat(1n, points(".1%"), "bool", budget())]).toEqual([...points("100.0%")]);
  expect([...integerFormat(9007199254740993n, points(".0f"), "int", budget())]).toEqual([...points("9007199254740992")]);
  expect(() => integerFormat(10n ** 400n, points(".2147483648f"), "int", budget())).toThrow("int too large to convert to float");
});
