import { expect, it } from "vitest";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Value { name: string; text?: CodePointString; exact?: boolean; str?: () => Value; repr?: () => Value }
const string = (value: string, exact = true): Value => ({ name: exact ? "str" : "S", text: new CodePointString(Uint32Array.from(Array.from(value), c => c.codePointAt(0)!)), exact });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
function fixture() {
  const fallback = string("<default>");
  const context: RepresentationContext<Value> = {
    isExactString: value => value.exact === true, string: value => value.text,
    lookupStr: value => value.str, lookupRepr: value => value.repr,
    defaultRepr: () => fallback, typeName: value => value.name,
    stringPoints: text => ({ name: "str", text, exact: true })
  };
  return { context, fallback };
}
it("returns exact str operands directly without lookup", () => {
  const { context } = fixture(), value = string("hello");
  context.lookupStr = () => { throw Error("lookup"); };
  expect(representationObject(value, "str", context, budget())).toBe(value);
});
it("honors subclass str overrides and does not recurse on returned subclasses", () => {
  const { context } = fixture(), result = string("hello", false), value = string("original", false);
  result.str = () => { throw Error("result must not be converted again"); };
  value.str = () => result;
  expect(representationObject(value, "str", context, budget())).toBe(result);
});
it("uses repr fallback for absent str and the default for absent repr", () => {
  const { context, fallback } = fixture(), result = string("repr", false), value = { name: "C", repr: () => result };
  expect(representationObject(value, "str", context, budget())).toBe(result);
  expect(representationObject(value, "repr", context, budget())).toBe(result);
  expect(representationObject({ name: "C" }, "str", context, budget())).toBe(fallback);
  expect(representationObject({ name: "C" }, "repr", context, budget())).toBe(fallback);
});
it("reports the requested slot when fallback repr returns a non-string", () => {
  const { context } = fixture(), value = { name: "C", repr: () => ({ name: "int" }) };
  expect(() => representationObject(value, "str", context, budget())).toThrow("__str__ returned non-string (type int)");
  for (const mode of ["repr", "ascii"] as const) expect(() => representationObject(value, mode, context, budget())).toThrow("__repr__ returned non-string (type int)");
  expect(() => representationObject({ name: "C", str: () => ({ name: "€".repeat(100) }) }, "str", context, budget())).toThrow("__str__ returned non-string (type " + "€".repeat(66) + ")");
});
it("preserves ASCII repr result identity, but creates exact strings when escaping", () => {
  const { context } = fixture(), ascii = string("\\raw\n", false), unicode = string("é😀", false);
  expect(representationObject({ name: "C", repr: () => ascii }, "ascii", context, budget())).toBe(ascii);
  const result = representationObject({ name: "C", repr: () => unicode }, "ascii", context, budget());
  expect(result.exact).toBe(true); expect(result).not.toBe(unicode);
  expect(String.fromCodePoint(...result.text!)).toBe("\\xe9\\U0001f600");
});
it("preserves slot errors without repr fallback or host coercion", () => {
  const { context } = fixture(), error = new PythonRuntimeError("TypeError", "disabled slot");
  const value = { name: "C", str: () => { throw error; }, repr: () => { throw Error("fallback"); } };
  expect(() => representationObject(value, "str", context, budget())).toThrow(error);
});
it("checks cancellation after lookup, invocation and string construction", () => {
  for (const stage of ["lookup", "invoke", "construct"] as const) {
    const { context } = fixture(), value = { name: "C" }; let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    context.lookupRepr = () => { if (stage === "lookup") cancelled = true; return () => { if (stage === "invoke") cancelled = true; return string("é"); }; };
    context.stringPoints = text => { cancelled = true; return { name: "str", text, exact: true }; };
    expect(() => representationObject(value, "ascii", context, meter)).toThrow(ExecutionLimitError);
  }
});
