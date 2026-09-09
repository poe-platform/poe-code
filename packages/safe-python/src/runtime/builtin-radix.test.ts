import { expect, it } from "vitest";
import { createRadixBuiltin } from "./builtin-radix.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import type { IntegerIndexContext } from "./index-protocol.js";

function fixture(name: "bin" | "oct" | "hex") {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createRadixBuiltin(name, v, meter);
  return { v, meter, keywords, builtin, call: (value: RuntimeValue) => builtin.value.invoke([value], keywords, meter) };
}
it.each(["bin", "oct", "hex"] as const)("renders %s prefixes after the sign with arbitrary-size integers", name => {
  const { v, call } = fixture(name), radix = { bin: 2, oct: 8, hex: 16 }[name], prefix = { bin: "0b", oct: "0o", hex: "0x" }[name];
  for (const value of [0n, 1n, -1n, 255n, -255n, (1n << 20000n) + 17n]) {
    const result = call(v.integer(value));
    expect(result).toEqual(v.string((value < 0n ? "-" : "") + prefix + (value < 0n ? -value : value).toString(radix)));
  }
  expect(call(v.true)).toEqual(v.string(prefix + "1"));
  expect(call(v.false)).toEqual(v.string(prefix + "0"));
});
it.each(["bin", "oct", "hex"] as const)("validates %s arguments before integer conversion", name => {
  const { v, meter, keywords, builtin, call } = fixture(name);
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes exactly one argument (0 given)`);
  expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow(`${name}() takes exactly one argument (2 given)`);
  expect(() => call(v.float(1))).toThrow("'float' object cannot be interpreted as an integer");
  expect(() => call(v.none)).toThrow("'NoneType' object cannot be interpreted as an integer");
  keywords.items.set(v.string("number"), v.integer(1));
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes no keyword arguments`);
});
it("uses guest index conversion and warning policy without int coercion", () => {
  const { v, meter, keywords } = fixture("hex"), guest = v.cell({}), warnings: string[] = [];
  let result: RuntimeValue = v.integer(-255);
  const index: IntegerIndexContext<RuntimeValue> = {
    integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
    isExactInteger: value => value.kind === "int", lookupIndex: value => value === guest ? () => result : undefined,
    typeName: value => value.kind, warn: (_category, message) => { warnings.push(message); }
  };
  const builtin = createRadixBuiltin("hex", v, meter, index), call = () => builtin.value.invoke([guest], keywords, meter);
  expect(call()).toEqual(v.string("-0xff"));
  result = v.true; expect(call()).toEqual(v.string("0x1")); expect(warnings[0]).toContain("strict subclass of int");
  result = v.float(1); expect(call).toThrow("__index__ returned non-int (type float)");
  const error = Error("slot failed"); index.lookupIndex = () => () => { throw error; }; expect(call).toThrow(error);
});
it("charges output work and allocation and keeps nonempty results fresh", () => {
  const { v, meter, keywords, builtin } = fixture("bin"), arg = v.integer(1);
  expect(builtin.value.invoke([arg], keywords, meter)).not.toBe(builtin.value.invoke([arg], keywords, meter));
  expect(() => builtin.value.invoke([arg], keywords, { checkpoint() { throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
