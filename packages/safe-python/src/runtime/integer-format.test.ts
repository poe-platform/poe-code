import { expect, it } from "vitest";
import { integerFormat } from "./integer-format.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";
import { renderIntegerRadixFormat } from "./integer-radix-format.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const points = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
const format = (n: bigint, spec: string) => [...integerFormat(n, points(spec), "int", budget())];
it("dispatches radix formats and adopts their output without another allocation", () => {
  expect(format(-1234n, "010,d")).toEqual([...points("-0,001,234")]);
  expect(format(255n, "#X")).toEqual([...points("0XFF")]);
  const direct = budget(), wrapped = budget(), spec = parseFormatSpec(points("#08x"), 100, ">", "int", budget());
  const output = renderIntegerRadixFormat(255n, spec, direct);
  expect([...CodePointString.fromIntegerRadixFormat(255n, spec, wrapped)]).toEqual([...output]);
  expect(wrapped.usage.allocatedBytes).toBe(direct.usage.allocatedBytes);
});
it("formats Unicode character points with alignment and without surrogate merging", () => {
  expect(format(65n, "05c")).toEqual([...points("0000A")]);
  expect(format(0x1f600n, "_^4c")).toEqual([95, 0x1f600, 95, 95]);
  expect(format(0xd800n, "c")).toEqual([0xd800]);
  expect(format(65n, "._c")).toEqual([65]);
});
it("preserves character flag and integer range diagnostic precedence", () => {
  for (const [spec, error] of [["z.0c", "Precision not allowed"], ["z+c", "Invalid format specifier"], ["zc", "Negative zero coercion"], ["+#c", "Sign not allowed"], ["#c", "Alternate form (#) not allowed"]]) expect(() => format(-1n, spec)).toThrow(error);
  for (const n of [-1n, 0x110000n]) expect(() => format(n, "c")).toThrow("%c arg not in range(0x110000)");
  for (const n of [1n << 63n, -(1n << 63n) - 1n]) expect(() => format(n, "c")).toThrow("Python int too large to convert to C long");
});
it("rejects unknown presentations before type-specific flag checks", () => {
  expect(() => format(1n, "z.0q")).toThrow("Unknown format code 'q' for object of type 'int'");
  expect(() => integerFormat(1n, points("😀"), "bool", budget())).toThrow("Unknown format code '\\x1f600' for object of type 'bool'");
});
