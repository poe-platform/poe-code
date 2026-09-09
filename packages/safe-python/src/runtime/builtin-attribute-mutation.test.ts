import { describe, expect, it } from "vitest";
import { createAttributeMutationBuiltin } from "./builtin-attribute-mutation.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, values, keywords };
}

describe("attribute mutation builtins", () => {
  it.each(["setattr", "delattr"] as const)("performs one %s operation and returns None", name => {
    const { meter, values: v, keywords } = fixture(), object = v.cell({}), key = v.cell({}), value = v.list([]), events: string[] = [];
    const context = {
      isString: (candidate: RuntimeValue) => candidate === key,
      setAttribute(receiver: RuntimeValue, attribute: RuntimeValue, assigned: RuntimeValue) { expect(this).toBe(context); expect(receiver).toBe(object); expect(attribute).toBe(key); expect(assigned).toBe(value); events.push("set"); return v.true; },
      deleteAttribute(receiver: RuntimeValue, attribute: RuntimeValue) { expect(this).toBe(context); expect(receiver).toBe(object); expect(attribute).toBe(key); events.push("delete"); return v.true; }
    };
    const builtin = createAttributeMutationBuiltin(name, v, meter, context);
    expect(builtin.value.invoke(name === "setattr" ? [object, key, value] : [object, key], keywords, meter)).toBe(v.none);
    expect(events).toEqual([name === "setattr" ? "set" : "delete"]);
  });
  it.each(["setattr", "delattr"] as const)("validates %s arguments before mutation", name => {
    const { meter, values: v, keywords } = fixture(), unused = () => { throw Error("unexpected mutation"); };
    const builtin = createAttributeMutationBuiltin(name, v, meter, { setAttribute: unused, deleteAttribute: unused });
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name} expected ${name === "setattr" ? 3 : 2} arguments, got 0`);
    expect(() => builtin.value.invoke(name === "setattr" ? [v.none, v.integer(1), v.none] : [v.none, v.integer(1)], keywords, meter)).toThrow("attribute name must be string, not 'int'");
    keywords.items.set(v.string("x"), v.none);
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes no keyword arguments`);
  });
  it.each(["setattr", "delattr"] as const)("preserves %s descriptor failures", name => {
    const { meter, values: v, keywords } = fixture(), failure = new PythonRuntimeError("AttributeError", "read only");
    const fail = () => { throw failure; };
    const builtin = createAttributeMutationBuiltin(name, v, meter, { setAttribute: fail, deleteAttribute: fail });
    expect(() => builtin.value.invoke(name === "setattr" ? [v.none, v.string("x"), v.true] : [v.none, v.string("x")], keywords, meter)).toThrow(failure);
  });
});
