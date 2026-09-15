import { expect, it } from "vitest";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { formatObject } from "./format-protocol.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = createRuntimeFormatContext(v, meter, { defaultRepr() { throw Error("unexpected guest representation"); } });
  return { v, format: (value: RuntimeValue, spec: string) => formatObject(value, v.string(spec), context, meter) };
}
it("canonicalizes single-character numeric presentation results", () => {
  const { v, format } = fixture();
  for (let digit = 0; digit < 10; digit++) {
    const expected = v.string(String(digit));
    for (const spec of ["d", "n", "x", "X"]) expect(format(v.integer(digit), spec)).toBe(expected);
    for (const spec of [".0f", ".1g", ".1n"]) expect(format(v.float(digit), spec)).toBe(expected);
  }
  expect(format(v.true, "d")).toBe(v.string("1"));
  for (const point of [0, 65, 233, 255]) expect(format(v.integer(point), "c")).toBe(v.string(String.fromCodePoint(point)));
});
it("canonicalizes truncated text while preserving an unchanged fresh string", () => {
  const { v, format } = fixture(), cached = v.string("é"), fresh = v.stringPoints(cached.value, "fresh");
  expect(format(v.string("éx"), ".1s")).toBe(cached);
  expect(format(fresh, "")).toBe(fresh);
  expect(format(fresh, "s")).toBe(fresh);
  expect(format(v.string("abc"), ".0s")).toBe(v.string(""));
});
it("keeps empty-spec integer conversion and non-Latin-1 output fresh", () => {
  const { v, format } = fixture(), digit = v.string("1");
  expect(format(v.integer(1), "")).not.toBe(digit);
  for (const point of [256, 0xd800, 0x1f600]) {
    const result = format(v.integer(point), "c");
    expect(result).toEqual(v.string(String.fromCodePoint(point)));
    expect(format(v.integer(point), "c")).not.toBe(result);
  }
});
it("distinguishes direct integer slots and brace formatting from the format fast path", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  for (const [receiver, name, args] of [[v.integer(1), "__format__", [v.string("")]], [v.string("{}"), "format", [v.integer(1)]]] as const) {
    const method = runtimeNativeAttribute(receiver, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected builtin");
    expect(method.value.invoke(args, keywords, meter)).toBe(v.string("1"));
  }
});
