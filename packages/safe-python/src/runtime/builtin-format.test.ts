import { expect, it } from "vitest";
import { createFormatBuiltin } from "./builtin-format.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context = {
    ...createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unresolved representation"); } }),
    isExactInteger: (value: RuntimeValue) => value.kind === "int",
    lookupFormat: (_value: RuntimeValue): ((spec: RuntimeValue) => RuntimeValue) | undefined => undefined
  };
  const builtin = createFormatBuiltin(v, meter, context);
  return { meter, v, keywords, context, builtin };
}
it("formats exact str/int with omitted and explicit empty specs", () => {
  const { v, meter, keywords, builtin } = fixture(), source = v.string("hello");
  expect(builtin.value.invoke([source], keywords, meter)).toBe(source);
  expect(builtin.value.invoke([source, v.string("")], keywords, meter)).toBe(source);
  expect(builtin.value.invoke([v.integer(12)], keywords, meter)).toEqual(v.string("12"));
});
it("checks keywords then arity then the public spec-type diagnostic", () => {
  const { v, meter, keywords, builtin } = fixture();
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("format expected at least 1 argument, got 0");
  expect(() => builtin.value.invoke([v.none, v.none, v.none], keywords, meter)).toThrow("format expected at most 2 arguments, got 3");
  expect(() => builtin.value.invoke([v.cell({}), v.integer(1)], keywords, meter)).toThrow("format() argument 2 must be str, not int");
  expect(() => builtin.value.invoke([v.integer(1), v.none], keywords, meter)).toThrow(new PythonRuntimeError("TypeError", "format() argument 2 must be str, not None"));
  keywords.items.set(v.string("value"), v.none);
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("format() takes no keyword arguments");
});
it("accepts subclass specs unchanged and preserves the slot result", () => {
  const { v, meter, keywords, context } = fixture(), spec = v.cell({}), guest = v.cell({}), result = v.string("result"), storage = v.string("spec").value;
  const builtin = createFormatBuiltin(v, meter, {
    ...context, string: value => value === spec ? storage : context.string(value),
    lookupFormat: value => value === guest ? received => { expect(received).toBe(spec); return result; } : undefined
  });
  expect(builtin.value.invoke([guest, spec], keywords, meter)).toBe(result);
});
it("bounds public type names at 50 UTF-8 bytes and preserves protocol failures", () => {
  const { v, meter, keywords, context } = fixture(), guest = v.cell({});
  const builtin = createFormatBuiltin(v, meter, { ...context, typeName: () => "é".repeat(100) });
  expect(() => builtin.value.invoke([v.none, guest], keywords, meter)).toThrow(`format() argument 2 must be str, not ${"é".repeat(25)}`);
  const error = Error("guest lookup");
  const failing = createFormatBuiltin(v, meter, { ...context, lookupFormat() { throw error; } });
  expect(() => failing.value.invoke([guest], keywords, meter)).toThrow(error);
  expect(() => failing.value.invoke([guest], keywords, { checkpoint() { throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
