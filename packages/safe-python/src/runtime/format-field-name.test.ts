import { expect, it } from "vitest";
import { scanFormatFieldName } from "./format-field-name.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const scan = (text: string) => scanFormatFieldName(values.string(text).value, meter);
  return { meter, values, scan };
}
it("splits first arguments, attributes and Unicode decimal item indices lazily", () => {
  const { scan } = fixture();
  expect([...scan("01.a[٢][x]")]).toEqual([
    { kind: "first", start: 0, end: 2, index: 1n },
    { kind: "attribute", start: 3, end: 4, index: null },
    { kind: "item", start: 5, end: 6, index: 2n },
    { kind: "item", start: 8, end: 9, index: null }
  ]);
  expect([...scan("")]).toEqual([{ kind: "first", start: 0, end: 0, index: null }]);
  expect([...scan("[0]")][0]).toEqual({ kind: "first", start: 0, end: 0, index: null });
  expect([...scan("²")][0].index).toBe(null);
  expect([...scan("𝟙٢3")][0].index).toBe(123n);
});
it("does not treat attribute names or opaque item text as numeric indices", () => {
  const { scan } = fixture();
  expect([...scan("x.123")][1].index).toBe(null);
  expect([...scan("x[a[b]")][1]).toEqual({ kind: "item", start: 2, end: 5, index: null });
  expect([...scan("-1")][0].index).toBe(null);
  expect([...scan("x[+1]")][1].index).toBe(null);
});
it("reports malformed suffixes only after preceding lookups can run", () => {
  const { scan } = fixture();
  for (const [source, message] of [["x[]", "Empty attribute"], ["x.", "Empty attribute"], ["x..a", "Empty attribute"], ["x[foo", "Missing ']'"]]) {
    const cursor = scan(source);
    expect(cursor.next().value.kind).toBe("first");
    expect(() => cursor.next()).toThrow(message);
  }
  const cursor = scan("x[foo]a"); cursor.next();
  expect(cursor.next().value.kind).toBe("item");
  expect(() => cursor.next()).toThrow("Only '.' or '[' may follow ']'");
});
it("bounds decimal accumulation before a later nondigit can turn it into a key", () => {
  const { scan } = fixture();
  expect([...scan("9223372036854775807")][0].index).toBe(9223372036854775807n);
  expect(() => scan("9223372036854775808x").next()).toThrow("Too many decimal digits in format string");
  const cursor = scan("x[9223372036854775808x]"); cursor.next();
  expect(() => cursor.next()).toThrow("Too many decimal digits in format string");
  expect([...scan("x.9223372036854775808")][1].index).toBe(null);
});
it("supports original-source spans and charges long scans", () => {
  const { values, meter } = fixture(), source = values.string("xx{a[0]}yy").value;
  expect([...scanFormatFieldName(source, meter, 3, 7)]).toEqual([{ kind: "first", start: 3, end: 4, index: null }, { kind: "item", start: 5, end: 6, index: 0n }]);
  expect(() => scanFormatFieldName(source, meter, -1).next()).toThrow(RangeError);
  const long = values.string("0".repeat(100)).value;
  expect(() => scanFormatFieldName(long, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 10000 })).next()).toThrow(ExecutionLimitError);
});
