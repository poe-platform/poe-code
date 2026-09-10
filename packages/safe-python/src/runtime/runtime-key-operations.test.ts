import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { createRuntimeKeyOperations } from "./runtime-key-operations.js";
import { RuntimeValues, type BuiltinInvocationContext } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  return { meter, values, hash };
}

it("provides native equality and the supplied hash domain without invocation hooks", () => {
  const { meter, values: v, hash } = fixture(), keys = createRuntimeKeyOperations(v, hash, meter);
  expect(keys.hash(v.string("key"))).toBe(23n); expect(keys.hash(v.integer(1))).toBe(keys.hash(v.true));
  expect(keys.equal(v.integer(1), v.true)).toBe(true); expect(keys.equal(v.integer(2), v.true)).toBe(false);
  expect(keys.hash(v.tuple([v.integer(7)]))).toBe(keys.hash(v.tuple([v.integer(7)])));
});

it("retains explicit guest hash policies and hash-error provenance", () => {
  const { meter, values: v, hash } = fixture(), failure = new PythonRuntimeError("TypeError", "sentinel");
  const keys = createRuntimeKeyOperations(v, { ...hash, guestHash: () => ({ lookupHash: () => () => { throw failure; }, integer: () => undefined, typeName: () => "External" }) }, meter);
  try { keys.hash(v.integer(1)); throw Error("expected hash failure"); }
  catch (error) { expect(error).toBeInstanceOf(RuntimeHashError); expect((error as RuntimeHashError).original).toBe(failure); }
});

it("preserves comparison and truth exceptions without host truthiness", () => {
  const { meter, values: v, hash } = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  const invocation: BuiltinInvocationContext = { call() { throw Error("unexpected call"); }, isStopIteration: () => false, compare: () => v.none, truth() { throw failure; } };
  const keys = createRuntimeKeyOperations(v, hash, meter, invocation);
  expect(() => keys.equal(v.integer(1), v.integer(2))).toThrow(failure);
  const comparison = createRuntimeKeyOperations(v, hash, meter, { ...invocation, compare() { throw failure; } });
  expect(() => comparison.equal(v.integer(1), v.integer(2))).toThrow(failure);
});
