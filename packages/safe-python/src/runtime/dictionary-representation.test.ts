import { expect, it } from "vitest";
import { dictionaryRepresentation } from "./dictionary-representation.js";
import { RepresentationStack } from "./representation-stack.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter), owner = v.cell({});
  const stack = new RepresentationStack<RuntimeValue>(100, meter);
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unexpected default"); } });
  const slots: [RuntimeValue, RuntimeValue][] = [];
  const render = () => dictionaryRepresentation(owner, () => slots.values(), context, stack, meter);
  const native = context.lookupRepr;
  context.lookupRepr = value => value === owner ? () => v.stringPoints(render()) : native(value);
  return { meter, v, owner, stack, context, slots, render };
}
it("renders empty dictionaries and ordered key/value representations", () => {
  const { v, slots, render } = fixture();
  expect(String.fromCodePoint(...render())).toBe("{}");
  slots.push([v.string("é"), v.integer(2)], [v.integer(3), v.list([v.none])]);
  expect(String.fromCodePoint(...render())).toBe("{'é': 2, 3: [None]}");
});
it("marks cycles before acquiring a cursor even for a cleared owner", () => {
  const { v, owner, slots, context, render } = fixture(), key = v.cell({}), native = context.lookupRepr;
  slots.push([key, v.integer(10)]);
  context.lookupRepr = value => value === key ? () => { slots.length = 0; return v.stringPoints(render()); } : native(value);
  expect(String.fromCodePoint(...render())).toBe("{{...}: 10}");
  slots.push([v.string("self"), owner]);
  expect(String.fromCodePoint(...render())).toBe("{'self': {...}}");
});
it("captures the current value before key repr and acquires later pairs live", () => {
  const { v, slots, context, render } = fixture(), key = v.cell({}), native = context.lookupRepr;
  slots.push([key, v.integer(10)], [v.integer(2), v.integer(20)]);
  context.lookupRepr = value => value === key ? () => {
    slots[0]![1] = v.integer(99); slots[1]![1] = v.integer(88);
    slots.push([v.integer(3), v.integer(30)]); return v.string("K");
  } : native(value);
  expect(String.fromCodePoint(...render())).toBe("{K: 10, 2: 88, 3: 30}");
});
it("restores the active path on cursor, key or value failure without closing the cursor", () => {
  for (const stage of ["cursor", "key", "value"] as const) {
    const { v, owner, stack, context, meter, slots, render } = fixture(), guest = v.cell({}), error = new Error(stage), native = context.lookupRepr;
    let fail = true, closes = 0;
    context.lookupRepr = value => value === guest ? () => { if (fail) throw error; return v.string("ok"); } : native(value);
    slots.push([stage === "key" ? guest : v.integer(1), stage === "value" ? guest : v.integer(2)]);
    expect(() => dictionaryRepresentation(owner, () => ({ next() { if (stage === "cursor") throw error; return { done: false, value: slots[0]! }; }, return() { closes++; return { done: true, value: undefined }; } }), context, stack, meter)).toThrow(error);
    expect(closes).toBe(0); fail = false;
    expect(String.fromCodePoint(...render())).toBe(stage === "cursor" ? "{1: 2}" : stage === "key" ? "{ok: 2}" : "{1: ok}");
  }
});
it("preserves surrogate code points and rejects invalid key repr before value repr", () => {
  const { v, slots, context, render } = fixture(), key = v.cell({}), value = v.cell({}), native = context.lookupRepr;
  let invalid = false, valueCalls = 0;
  slots.push([key, value]);
  context.lookupRepr = item => item === key ? () => invalid ? v.none : v.stringPoints(Uint32Array.of(0xd800, 0xdc00)) : item === value ? () => { valueCalls++; return v.string("v"); } : native(item);
  expect([...render()]).toEqual([123, 0xd800, 0xdc00, 58, 32, 118, 125]);
  invalid = true;
  expect(() => render()).toThrow("__repr__ returned non-string (type NoneType)");
  expect(valueCalls).toBe(1);
});
