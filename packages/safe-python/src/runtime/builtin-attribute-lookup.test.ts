import { describe, expect, it } from "vitest";
import { createAttributeLookupBuiltin } from "./builtin-attribute-lookup.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, values, keywords };
}

describe("attribute lookup builtins", () => {
  it("preserves guest string-subclass names and recognizes guest AttributeError subclasses", () => {
    const { meter, values: v, keywords } = fixture(), key = v.cell({}), missing = Error("guest attribute subclass"), fallback = v.list([]);
    const builtin = createAttributeLookupBuiltin("getattr", v, meter, {
      isString: value => value === key,
      attribute: (_object, name) => { expect(name).toBe(key); throw missing; },
      isAttributeError: error => error === missing
    });
    expect(builtin.value.invoke([v.none, key, fallback], keywords, meter)).toBe(fallback);
  });
  it("does not let guest exception classification suppress fatal execution signals", () => {
    const { meter, values: v, keywords } = fixture(), failure = new ExecutionLimitError("allocation");
    const builtin = createAttributeLookupBuiltin("hasattr", v, meter, {
      attribute: () => { throw failure; }, isAttributeError: () => { throw Error("must not classify fatal errors"); }
    });
    expect(() => builtin.value.invoke([v.none, v.string("x")], keywords, meter)).toThrow(failure);
  });
  it.each(["getattr", "hasattr"] as const)("performs exactly one lookup for %s and preserves the name object", name => {
    const { meter, values: v, keywords } = fixture(), object = v.cell({}), key = v.string("a\0😀"), answer = v.list([]);
    let calls = 0;
    const context = { attribute(receiver: RuntimeValue, attribute: RuntimeValue) { expect(this).toBe(context); expect(receiver).toBe(object); expect(attribute).toBe(key); calls++; return answer; } };
    const builtin = createAttributeLookupBuiltin(name, v, meter, context);
    expect(builtin.value.invoke([object, key], keywords, meter)).toBe(name === "getattr" ? answer : v.true);
    expect(calls).toBe(1);
  });
  it.each(["getattr", "hasattr"] as const)("suppresses only AttributeError for %s fallback", name => {
    const { meter, values: v, keywords } = fixture(), fallback = v.list([]);
    let failure = new PythonRuntimeError("AttributeError", "missing");
    const builtin = createAttributeLookupBuiltin(name, v, meter, { attribute: () => { throw failure; } });
    const args = name === "getattr" ? [v.none, v.string("x"), fallback] : [v.none, v.string("x")];
    expect(builtin.value.invoke(args, keywords, meter)).toBe(name === "getattr" ? fallback : v.false);
    failure = new PythonRuntimeError("ValueError", "descriptor failed");
    expect(() => builtin.value.invoke(args, keywords, meter)).toThrow(failure);
  });
  it("does not classify or suppress missing attributes without a getattr default", () => {
    const { meter, values: v, keywords } = fixture(), failure = new PythonRuntimeError("AttributeError", "missing");
    const builtin = createAttributeLookupBuiltin("getattr", v, meter, { attribute: () => { throw failure; }, isAttributeError: () => { throw Error("unexpected classification"); } });
    expect(() => builtin.value.invoke([v.none, v.string("x")], keywords, meter)).toThrow(failure);
  });
  it.each(["getattr", "hasattr"] as const)("validates %s arguments before lookup", name => {
    const { meter, values: v, keywords } = fixture();
    const builtin = createAttributeLookupBuiltin(name, v, meter, { attribute: () => { throw Error("unexpected lookup"); } });
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(name === "getattr" ? "getattr expected at least 2 arguments, got 0" : "hasattr expected 2 arguments, got 0");
    expect(() => builtin.value.invoke([v.none, v.integer(1)], keywords, meter)).toThrow("attribute name must be string, not 'int'");
    keywords.items.set(v.string("x"), v.none);
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes no keyword arguments`);
  });
});
