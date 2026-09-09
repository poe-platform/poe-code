import { expect, it } from "vitest";
import { createRepresentationBuiltin } from "./builtin-representation.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unresolved representation"); } });
  const repr = createRepresentationBuiltin("repr", v, meter, context), ascii = createRepresentationBuiltin("ascii", v, meter, context);
  return { meter, v, keywords, context, repr, ascii };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("renders native objects and escapes only the ascii builtin's non-ASCII output", () => {
  const { v, meter, keywords, repr, ascii } = fixture(), value = v.list([v.string("é😀"), v.none, v.integer(12)]);
  expect(text(repr.value.invoke([value], keywords, meter))).toBe("['é😀', None, 12]");
  expect(text(ascii.value.invoke([value], keywords, meter))).toBe("['\\xe9\\U0001f600', None, 12]");
});
it("validates keywords before positional arity and before conversion", () => {
  const { v, meter, keywords, repr, ascii } = fixture();
  for (const [name, builtin] of [["repr", repr], ["ascii", ascii]] as const) {
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes exactly one argument (0 given)`);
    expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow(`${name}() takes exactly one argument (2 given)`);
    keywords.items.set(v.string("object"), v.cell({}));
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes no keyword arguments`);
    keywords.items.clear();
  }
});
it("retains guest repr result identity and rejects non-string results", () => {
  const { v, meter, keywords, context } = fixture(), guest = v.cell({}), result = v.string("ASCII");
  const custom = { ...context, lookupRepr: () => () => result };
  for (const name of ["repr", "ascii"] as const) expect(createRepresentationBuiltin(name, v, meter, custom).value.invoke([guest], keywords, meter)).toBe(result);
  const invalid = createRepresentationBuiltin("ascii", v, meter, { ...context, lookupRepr: () => () => v.integer(3) });
  expect(() => invalid.value.invoke([guest], keywords, meter)).toThrow("__repr__ returned non-string (type int)");
});
it("shares guards across repr/ascii calls made by a guest representation", () => {
  const { v, meter, keywords } = fixture(), guest = v.cell({}), list = v.list([guest]);
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: item => item === guest ? () => ascii.value.invoke([list], keywords, meter) : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  const repr = createRepresentationBuiltin("repr", v, meter, context), ascii = createRepresentationBuiltin("ascii", v, meter, context);
  expect(text(repr.value.invoke([list], keywords, meter))).toBe("[[...]]");
  expect(text(ascii.value.invoke([list], keywords, meter))).toBe("[[...]]");
});
it("preserves guest failures and checks cancellation at invocation", () => {
  const { v, meter, keywords, context, repr } = fixture(), error = Error("guest");
  const custom = createRepresentationBuiltin("repr", v, meter, { ...context, lookupRepr: () => () => { throw error; } });
  expect(() => custom.value.invoke([v.cell({})], keywords, meter)).toThrow(error);
  const cancelled = { checkpoint() { throw new ExecutionLimitError("cancelled"); } };
  expect(() => repr.value.invoke([v.none], keywords, cancelled)).toThrow(ExecutionLimitError);
});
