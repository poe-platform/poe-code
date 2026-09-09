import { expect, it } from "vitest";
import { stringFormat } from "./string-format.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const string = (s: string) => new CodePointString(Uint32Array.from([...s].map(c => c.codePointAt(0)!)), meter);
  const format = (s: string, spec: string) => [...stringFormat(string(s), string(spec), "str", meter)];
  return { meter, string, format };
}
it("renders alignment with format-style odd centering", () => {
  const { format, string } = fixture();
  for (const [spec, expected] of [["5", "ab   "], [">5", "   ab"], [".^5", ".ab.."], ["05", "ab000"], ["0>5", "000ab"], ["😀^5", "😀ab😀😀"]]) expect(format("ab", spec)).toEqual([...string(expected)]);
});
it("truncates in code points before fill, retaining surrogate points", () => {
  const { format } = fixture();
  expect(format("😀éz", "_>4.2s")).toEqual([95, 95, 0x1f600, 233]);
  expect(format("abc", "x^5.0s")).toEqual([120, 120, 120, 120, 120]);
  expect(format("é", "\ud800>3s")).toEqual([0xd800, 0xd800, 233]);
});
it("retains unchanged storage and allows fractional grouping syntax", () => {
  const { string, meter } = fixture(), source = string("abc");
  for (const spec of ["", "s", "2s", ".9s", "._s", ".,s"]) expect(stringFormat(source, string(spec), "str", meter)).toBe(source);
});
it("orders presentation, sign, z, alternate and alignment errors", () => {
  const { format } = fixture();
  for (const [spec, error] of [["+z#=d", "Invalid format specifier"], ["+d", "Unknown format code 'd'"], ["+zs", "Sign not allowed"], [" zs", "Space not allowed"], ["z#s", "Negative zero coercion (z) not allowed"], ["=#s", "Alternate form (#) not allowed"], ["=s", "'=' alignment not allowed"], ["😀", "Unknown format code '\\x1f600'"], [",s", "Cannot specify ',' with 's'."]]) expect(() => format("abc", spec)).toThrow(error);
});
