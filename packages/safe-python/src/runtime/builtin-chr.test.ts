import { expect, it } from "vitest";
import { createChrBuiltin } from "./builtin-chr.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import type { IntegerIndexContext } from "./index-protocol.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createChrBuiltin(v, meter);
  return { v, meter, keywords, builtin, call: (value: RuntimeValue) => builtin.value.invoke([value], keywords, meter) };
}
it("constructs Unicode characters including independent surrogates and cached Latin-1", () => {
  const { v, call } = fixture();
  for (let point = 0; point < 256; point++) expect(call(v.integer(point))).toBe(v.string(String.fromCodePoint(point)));
  for (const point of [256, 0xd800, 0xdc00, 0x1f600, 0x10ffff]) {
    const result = call(v.integer(point));
    expect(result).toEqual(v.stringPoints(Uint32Array.of(point)));
    expect(call(v.integer(point))).not.toBe(result);
  }
  expect(call(v.true)).toBe(v.string("\x01"));
  expect(call(v.false)).toBe(v.string("\0"));
});
it("reports Unicode range errors without machine-integer overflow", () => {
  const { v, call } = fixture();
  for (const value of [-1n, 0x110000n, 2147483648n, -(1n << 1000n), 1n << 1000n]) expect(() => call(v.integer(value))).toThrow("chr() arg not in range(0x110000)");
  expect(() => call(v.float(65))).toThrow("'float' object cannot be interpreted as an integer");
  expect(() => call(v.none)).toThrow("'NoneType' object cannot be interpreted as an integer");
});
it("checks keyword arguments and arity before converting the value", () => {
  const { v, meter, keywords, builtin } = fixture();
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("chr() takes exactly one argument (0 given)");
  expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow("chr() takes exactly one argument (2 given)");
  keywords.items.set(v.string("i"), v.integer(65));
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("chr() takes no keyword arguments");
});
it.each([false, true])("uses guest index slots and warnings with explicit policy=%s", explicit => {
  const { v, meter, keywords } = fixture(), guest = v.cell({}), warnings: string[] = [];
  let result: RuntimeValue = v.integer(65);
  const context: IntegerIndexContext<RuntimeValue> = {
    integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
    isExactInteger: value => value.kind === "int", lookupIndex: value => value === guest ? () => result : undefined,
    typeName: value => value.kind, warn: (_category, message) => { warnings.push(message); }
  };
  const unused = (): never => { throw Error("unexpected invocation callback"); };
  const builtin = createChrBuiltin(v, meter, explicit ? context : undefined), call = () => builtin.value.invoke([guest], keywords, meter, {
    call: unused, isStopIteration: unused, integerIndex: explicit ? { ...context, lookupIndex: unused } : context
  });
  expect(call()).toBe(v.string("A"));
  result = v.true; expect(call()).toBe(v.string("\x01")); expect(warnings[0]).toContain("strict subclass of int");
  result = v.string("65"); expect(() => call()).toThrow("__index__ returned non-int (type str)");
  const error = Error("guest slot"); context.lookupIndex = () => () => { throw error; };
  expect(call).toThrow(error);
});
it("checks cancellation even when the character is already cached", () => {
  const { v, keywords, builtin } = fixture(); v.string("A");
  expect(() => builtin.value.invoke([v.integer(65)], keywords, { checkpoint() { throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
