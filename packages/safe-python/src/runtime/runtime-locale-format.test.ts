import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { createRuntimeFormatContext, type RuntimeFormatHooks } from "./runtime-format.js";
import { formatObject } from "./format-protocol.js";
import { NumericLocale } from "./numeric-locale.js";

function fixture(hooks?: Partial<RuntimeFormatHooks>) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const v = new RuntimeValues(meter);
  const context = createRuntimeFormatContext(v, meter, { defaultRepr() { throw Error("unexpected guest representation"); }, ...hooks });
  return { meter, v, context };
}
it("defaults native n formats to the portable C locale", () => {
  const { meter, v, context } = fixture();
  for (const [value, expected] of [
    [v.integer(1234567), "1234567"], [v.boolean(true), "1"],
    [v.float(1234.5), "1234.5"], [v.complex(1234.5, -6.25), "1234.5-6.25j"]
  ] as const) expect(formatObject(value, v.string("n"), context, meter)).toEqual(v.string(expected));
});
it("resolves an execution-owned snapshot only for locale presentations", () => {
  let calls = 0;
  const { meter, v, context } = fixture({ numericLocale() { calls++; return current; } });
  let current = new NumericLocale({ decimalPoint: v.string(",").value, thousandsSeparator: v.string(".").value, grouping: [3, 0] }, meter);
  expect(formatObject(v.float(1234.5), v.string("f"), context, meter)).toEqual(v.string("1234.500000"));
  expect(calls).toBe(0);
  expect(formatObject(v.float(1234.5), v.string("n"), context, meter)).toEqual(v.string("1.234,5"));
  current = new NumericLocale({ decimalPoint: v.string(".").value, thousandsSeparator: v.string("_").value, grouping: [3, 2, 0] }, meter);
  expect(formatObject(v.integer(1234567), v.string("n"), context, meter)).toEqual(v.string("12_34_567"));
  expect(formatObject(v.complex(1234.5, 6.25), v.string("n"), context, meter)).toEqual(v.string("1_234.5+6.25j"));
  expect(calls).toBe(3);
});
