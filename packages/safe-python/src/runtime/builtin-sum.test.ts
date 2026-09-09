import { expect, it } from "vitest";
import { createSumBuiltin, type SumContext } from "./builtin-sum.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeBinary } from "./runtime-binary.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context: SumContext = { add: (a, b) => runtimeBinary("+", a, b, v, meter) };
  const builtin = createSumBuiltin(v, meter, context);
  return { v, meter, context, keywords, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}
it("binds default, positional and keyword start before staged accumulation", () => {
  const { v, call, keywords } = fixture(), source = v.list([v.integer(1), v.integer(2)]);
  expect(call(source)).toBe(v.integer(3));
  expect(call(source, v.integer(10))).toBe(v.integer(13));
  keywords.items.set(v.string("start"), v.integer(20)); expect(call(source)).toBe(v.integer(23));
});
it("enforces positional-only source, total arity and keyword spelling", () => {
  const { v, call, keywords } = fixture();
  expect(() => call()).toThrow("sum() takes at least 1 positional argument (0 given)");
  expect(() => call(v.none, v.none, v.none)).toThrow("sum() takes at most 2 arguments (3 given)");
  keywords.items.set(v.string("start"), v.none);
  expect(() => call(v.none, v.none)).toThrow("sum() takes at most 2 arguments (3 given)");
  keywords.items.clear(); keywords.items.set(v.string("iterable"), v.none);
  expect(() => call(v.none)).toThrow("sum() got an unexpected keyword argument 'iterable'");
  keywords.items.clear(); keywords.items.set(v.string("star"), v.none);
  expect(() => call(v.none)).toThrow("Did you mean 'start'?");
});
it("acquires input before rejecting string, bytes and guest bytearray starts", () => {
  const { v, call, context } = fixture();
  expect(() => call(v.none, v.string(""))).toThrow("'NoneType' object is not iterable");
  expect(() => call(v.list([]), v.string(""))).toThrow("sum() can't sum strings [use ''.join(seq) instead]");
  expect(() => call(v.list([]), v.bytes(new Uint8Array()))).toThrow("sum() can't sum bytes [use b''.join(seq) instead]");
  context.stringStart = () => "bytearray";
  expect(() => call(v.list([]), v.cell({}))).toThrow("sum() can't sum bytearray [use b''.join(seq) instead]");
});
it("returns arbitrary generic starts unchanged for empty iterables", () => {
  const { v, call } = fixture(), start = v.list([]);
  expect(call(v.list([]), start)).toBe(start);
  expect(call(v.list([]), v.true)).toBe(v.true);
});
