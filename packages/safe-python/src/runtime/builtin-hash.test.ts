import { describe, expect, it } from "vitest";
import { createHashBuiltin } from "./builtin-hash.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const context: RuntimeHashContext = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const hash = createHashBuiltin(values, meter, context);
  return { meter, values, context, keywords, hash, call: (...args: RuntimeValue[]) => hash.value.invoke(args, keywords, meter) };
}

describe("concrete hash builtin", () => {
  it("uses the execution hash policy for primitive and composite values", () => {
    const { values: v, context, meter, call } = fixture();
    for (const value of [v.none, v.true, v.integer(-1), v.integer(1n << 100n), v.float(1.5), v.string("hello"), v.bytes(new Uint8Array([1, 2])), v.tuple([v.integer(3), v.string("x")])]) {
      expect(call(value)).toEqual(v.integer(runtimeHash(value, context, meter)));
    }
  });
  it("rejects keywords before arity or hashing", () => {
    const { values: v, call, keywords, context } = fixture();
    context.identity = () => { throw Error("must not hash"); };
    expect(() => call()).toThrow("hash() takes exactly one argument (0 given)");
    expect(() => call(v.none, v.none)).toThrow("hash() takes exactly one argument (2 given)");
    keywords.items.set(v.string("x"), v.none);
    expect(() => call(v.none)).toThrow("hash() takes no keyword arguments");
  });
  it("preserves unhashable errors inside composite inputs", () => {
    const { values: v, call } = fixture();
    expect(() => call(v.list([]))).toThrow("unhashable type: 'list'");
    expect(() => call(v.tuple([v.list([])]))).toThrow("unhashable type: 'list'");
  });
  it("preserves hash-policy failures", () => {
    const { values: v, call, context } = fixture(), failure = Error("hash policy failed");
    context.string = () => { throw failure; };
    expect(() => call(v.string("x"))).toThrow(failure);
  });
});
