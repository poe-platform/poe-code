import { expect, it } from "vitest";
import { textPercentFormat } from "./text-percent-format.js";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = { ...createRuntimePercentBindingContext(v, meter), ...createRuntimePercentConversionContext(meter), ...createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("unexpected default"); } }) };
  return { meter, v, context };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("preserves a literal-only source and a sole unmodified string field", () => {
  const { meter, v, context } = fixture(), source = v.string("literal"), argument = v.string("hello");
  expect(textPercentFormat(source, v.tuple([]), context, meter)).toBe(source);
  for (const format of ["%s", "%2s", "%.10s", "%#0+s"]) expect(textPercentFormat(v.string(format), argument, context, meter)).toBe(argument);
});
it("creates combined output without aliasing a nonempty field", () => {
  const { meter, v, context } = fixture(), argument = v.string("hello");
  const result = textPercentFormat(v.string("%s%s"), v.tuple([argument, v.string("")]), context, meter);
  expect(result).not.toBe(argument); expect(text(result)).toBe("hello");
  expect(text(textPercentFormat(v.string("[%#x|%+.2f|%c]"), v.tuple([v.integer(255), v.float(1.25), v.integer(65)]), context, meter))).toBe("[0xff|+1.25|A]");
});
it("preserves literal-only string subclasses and sole representation subclasses", () => {
  const { meter, v, context } = fixture(), source = v.cell({}), argument = v.cell({}), result = v.cell({});
  const sourceStorage = v.string("literal").value, resultStorage = v.string("hello").value;
  const originalString = context.string;
  context.string = value => value === source ? sourceStorage : value === result ? resultStorage : originalString(value);
  context.lookupRepr = value => value === argument ? () => result : undefined;
  expect(textPercentFormat(source, v.tuple([]), context, meter)).toBe(source);
  expect(textPercentFormat(v.string("%r"), argument, context, meter)).toBe(result);
  expect(textPercentFormat(v.string("%a"), argument, context, meter)).toBe(result);
  expect(textPercentFormat(v.string("%.2r"), argument, context, meter)).not.toBe(result);
});
it("prioritizes a field result over a source that shares its immutable storage", () => {
  const { meter, v, context } = fixture(), source = v.string("%s"), argument = v.stringPoints(source.value);
  expect(argument).not.toBe(source);
  expect(textPercentFormat(source, argument, context, meter)).toBe(argument);
});
it("does not publish a candidate before surplus and grammar validation", () => {
  const { meter, v, context } = fixture(), argument = v.string("hello");
  expect(() => textPercentFormat(v.string("%s"), v.tuple([argument, v.true]), context, meter)).toThrow("not all arguments converted");
  expect(() => textPercentFormat(v.string("%s%"), argument, context, meter)).toThrow("incomplete format");
  expect(() => textPercentFormat(v.string("%q"), v.tuple([]), context, meter)).toThrow("not enough arguments");
});
it("preserves callback ownership and checks final construction cancellation", () => {
  const { v, context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const tupleItems = context.tupleItems;
  context.tupleItems = function(value) { expect(this).toBe(context); return tupleItems(value); };
  context.stringPoints = storage => { cancelled = true; return v.stringPoints(storage); };
  expect(() => textPercentFormat(v.string("a%%b"), v.tuple([]), context, meter)).toThrow(ExecutionLimitError);
});
