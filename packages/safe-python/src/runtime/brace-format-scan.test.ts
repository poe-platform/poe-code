import { expect, it } from "vitest";
import { scanBraceFormat } from "./brace-format-scan.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  function scan(text: string) {
    const source = values.string(text).value;
    return [...scanBraceFormat(source, meter)].map(event => {
      const text = (span: { start: number; end: number }) => String.fromCodePoint(...source.slice(BigInt(span.start), BigInt(span.end), null, meter));
      return [text(event.literal), event.field === null ? null : text(event.field), event.spec === null ? null : text(event.spec), event.conversion === null ? null : String.fromCodePoint(event.conversion), event.expand];
    });
  }
  return { meter, values, scan };
}
it("scans escaped braces and fields without copying source text", () => {
  const { scan } = fixture();
  expect(scan("😀{{b}}c{x!r:>{w}}d")).toEqual([
    ["😀{", null, null, null, false], ["b}", null, null, null, false],
    ["c", "x", ">{w}", "r", true], ["d", null, null, null, false]
  ]);
  expect(scan("{}{:}{x!a}{x!\0}")).toEqual([["", "", "", null, false], ["", "", "", null, false], ["", "x", "", "a", false], ["", "x", "", null, false]]);
  expect(scan("")).toEqual([]);
});
it("keeps bracket keys opaque and nested specs unexpanded", () => {
  const { scan } = fixture();
  expect(scan("{a[}:!]!x:hi}")).toEqual([["", "a[}:!]", "hi", "x", false]]);
  expect(scan("{a:{b:{c}}}")).toEqual([["", "a", "{b:{c}}", null, true]]);
  expect(scan("{a:{{}}}")).toEqual([["", "a", "{{}}", null, true]]);
});
it("reports precise incomplete-field diagnostics", () => {
  const { scan } = fixture();
  for (const [source, message] of [
    ["abc{", "Single '{' encountered in format string"], ["}", "Single '}' encountered in format string"],
    ["{a", "expected '}' before end of string"], ["{a[foo}", "expected '}' before end of string"],
    ["{a{b}}", "unexpected '{' in field name"], ["{a!", "end of string while looking for conversion specifier"],
    ["{a!rX}", "expected ':' after conversion specifier"], ["{a!}", "unmatched '{' in format spec"],
    ["{a:", "unmatched '{' in format spec"]
  ]) expect(() => scan(source)).toThrow(message);
});
it("defers later errors until earlier fields have been consumed", () => {
  const { meter, values } = fixture();
  const cursor = scanBraceFormat(values.string("{x}later{").value, meter);
  expect(cursor.next().value.field).toEqual({ start: 1, end: 2 });
  expect(() => cursor.next()).toThrow("Single '{'");
});
it("bounds scanning and supports source spans for nested expansion", () => {
  const { meter, values } = fixture(), source = values.string("xx{x}yy").value;
  expect([...scanBraceFormat(source, meter, 2, 5)][0].field).toEqual({ start: 3, end: 4 });
  expect(() => [...scanBraceFormat(source, meter, -1, 5)]).toThrow(RangeError);
  expect(() => [...scanBraceFormat(source, meter, 2, 8)]).toThrow(RangeError);
  const long = values.string("a".repeat(100)).value;
  expect(() => scanBraceFormat(long, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 10000 })).next()).toThrow(ExecutionLimitError);
});
