import { describe, expect, it } from "vitest";
import { createLenBuiltin } from "./builtin-len.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { createRange } from "./integer-sequence.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const len = createLenBuiltin(v, meter);
  return { v, meter, keywords, len, call: (...args: RuntimeValue[]) => len.value.invoke(args, keywords, meter) };
}

describe("concrete len builtin", () => {
  it("returns exact lengths of sequences, strings, bytes and dictionaries", () => {
    const { v, call, keywords } = fixture();
    for (const [value, expected] of [[v.list([v.none]), 1], [v.tuple([v.none, v.true]), 2], [v.string("a😀"), 2], [v.bytes(new Uint8Array([0, 255, 1])), 3], [keywords, 0], [v.range(createRange(0n, 8n, 2n)), 4]] as const) expect(call(value)).toEqual(v.integer(expected));
  });
  it("reads live lengths without inspecting cyclic members", () => {
    const { v, call } = fixture(), list = v.list([]);
    list.items.append(list); expect(call(list)).toEqual(v.integer(1)); list.items.append(v.none); expect(call(list)).toEqual(v.integer(2));
  });
  it("checks keywords before positional arity or operand length", () => {
    const { v, call, keywords } = fixture();
    expect(() => call()).toThrow("len() takes exactly one argument (0 given)");
    expect(() => call(v.none, v.none)).toThrow("len() takes exactly one argument (2 given)");
    keywords.items.set(v.string("x"), v.none); expect(() => call()).toThrow("len() takes no keyword arguments");
  });
  it("rejects values without length without invoking builtin or iterator payloads", () => {
    const { v, call, len } = fixture();
    for (const value of [v.none, v.integer(1), v.slice({}), len, v.iterator({ next() { throw new Error("must not iterate"); } })]) {
      const name = value.kind === "none" ? "NoneType" : value.kind;
      expect(() => call(value)).toThrow(`object of type '${name}' has no len()`);
    }
  });
  it("rejects a range length outside the signed platform-size domain", () => {
    const { v, call } = fixture();
    expect(() => call(v.range(createRange(0n, 2n ** 100n, 1n)))).toThrow("Python int too large to convert to C ssize_t");
  });
});
