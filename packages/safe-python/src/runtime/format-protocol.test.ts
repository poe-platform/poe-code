import { expect, it } from "vitest";
import { formatObject, type FormatContext } from "./format-protocol.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

type Value = { name: string; text?: CodePointString; exact?: boolean; integer?: boolean; repr?: () => Value; format?: (spec: Value) => Value };
function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), trace: string[] = [];
  const string = (text: string, exact = true): Value => ({ name: exact ? "str" : "S", exact, text: new CodePointString(Uint32Array.from([...text].map(c => c.codePointAt(0)!)), meter) });
  const context: FormatContext<Value> = {
    string: value => value.text, isExactString: value => value.exact === true,
    isExactInteger: value => value.integer === true,
    lookupFormat: value => { trace.push("lookup:" + value.name); return value.format; },
    lookupStr: value => value.repr, lookupRepr: value => value.repr,
    defaultRepr() { throw Error("unexpected default"); },
    typeName: value => value.name,
    stringPoints: text => ({ name: "str", text, exact: true })
  };
  return { meter, trace, string, context };
}
it("bypasses format lookup only for exact str/int and an empty spec", () => {
  const { meter, trace, string, context } = fixture(), text = string("hello"), digits = string("12");
  expect(formatObject(text, undefined, context, meter)).toBe(text);
  expect(formatObject(text, string("", false), context, meter)).toBe(text);
  expect(formatObject({ name: "int", integer: true, repr: () => digits }, undefined, context, meter)).toBe(digits);
  expect(trace).toEqual([]);
});
it("passes an explicit str subclass spec unchanged and preserves result identity", () => {
  const { meter, trace, string, context } = fixture(), spec = string("x", false), result = string("output", false);
  const value = { name: "C", format: (received: Value) => { expect(received).toBe(spec); return result; } };
  expect(formatObject(value, spec, context, meter)).toBe(result);
  expect(trace).toEqual(["lookup:C"]);
});
it("supplies an exact empty string to ordinary slots when the spec is omitted", () => {
  const { meter, string, context } = fixture(), result = string("ok");
  for (const name of ["C", "bool", "S", "IntSubclass"]) {
    const value = { name, format: (spec: Value) => { expect(spec.exact).toBe(true); expect(spec.text?.length).toBe(0); return result; } };
    expect(formatObject(value, undefined, context, meter)).toBe(result);
  }
});
it("validates spec type before any value lookup, using the internal API diagnostic", () => {
  const { meter, trace, string, context } = fixture();
  expect(() => formatObject(string("x"), { name: "int" }, context, meter)).toThrow("Format specifier must be a string, not int");
  expect(trace).toEqual([]);
});
it("distinguishes absent format slots from invalid results and bounds type names", () => {
  const { meter, string, context } = fixture();
  expect(() => formatObject({ name: "C" }, string(""), context, meter)).toThrow("Type C doesn't define __format__");
  expect(() => formatObject({ name: "é".repeat(70) }, undefined, context, meter)).toThrow(`Type ${"é".repeat(50)} doesn't define __format__`);
  expect(() => formatObject({ name: "C", format: () => ({ name: "int" }) }, undefined, context, meter)).toThrow("__format__ must return a str, not int");
  expect(() => formatObject({ name: "C", format: () => ({ name: "é".repeat(120) }) }, undefined, context, meter)).toThrow(`__format__ must return a str, not ${"é".repeat(100)}`);
});
it("preserves method failures and checks cancellation after supplied hooks", () => {
  const { meter, context, string } = fixture(), error = Error("guest format");
  expect(() => formatObject({ name: "C", format() { throw error; } }, undefined, context, meter)).toThrow(error);
  let cancelled = false;
  const cancellable = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const result = string("ok");
  expect(() => formatObject({ name: "C", format() { cancelled = true; return result; } }, undefined, context, cancellable)).toThrow(ExecutionLimitError);
});
