import { describe, expect, it } from "vitest";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { constantHash } from "./constant-hash.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { createFunctionState } from "./function-state.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const identities = new WeakMap<object, bigint>(); let next = 10n;
  const context: RuntimeHashContext = {
    none: v.none,
    identity(value) { let hash = identities.get(value); if (hash === undefined) { hash = next++; identities.set(value, hash); } return hash; },
    string: () => 23n, bytes: () => 29n
  };
  return { meter, v, context };
}

describe("runtime value hashing", () => {
  it("rejects lists directly and inside immutable keys", () => {
    const { meter, v, context } = fixture(), list = v.list([]);
    for (const value of [list, v.tuple([list]), v.slice({ lower: list })]) {
      expect(() => runtimeHash(value, context, meter)).toThrow(expect.objectContaining({ name: "TypeError", message: "unhashable type: 'list'" }));
    }
  });
  it("does not traverse cyclic unhashable lists or inspect later tuple members", () => {
    const { meter, v, context } = fixture(), list = v.list([]); list.items.append(list);
    const key = v.tuple([list, v.string("later")]); let calls = 0;
    expect(() => runtimeHash(key, { ...context, string: () => { calls++; return 1n; } }, meter)).toThrow("unhashable type: 'list'");
    expect(calls).toBe(0);
  });
  it("uses stable identity for function and iterator records", () => {
    const { meter, v, context } = fixture(), iterator = v.iterator({ next: () => { throw new Error("advanced"); } });
    const code = compileProgram<RuntimeValue>(analyzeModule("def f():\n pass\n"), { stripDocstring: false }, v, meter).functions.values().next().value!;
    const state = createFunctionState(code, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter);
    const first = v.function(state), second = v.function(state);
    expect(runtimeHash(first, context, meter)).toBe(runtimeHash(first, context, meter));
    expect(runtimeHash(first, context, meter)).not.toBe(runtimeHash(second, context, meter));
    expect(runtimeHash(iterator, context, meter)).toBe(runtimeHash(iterator, context, meter));
    expect(runtimeHash(first, { ...context, identity: () => -1n }, meter)).toBe(-2n);
  });
  it("hashes canonical range keys including empty and singleton ranges", () => {
    const { meter, v, context } = fixture();
    for (const [start, stop, step] of [[0n, 0n, 1n], [5n, 6n, 8n], [0n, 6n, 2n], [0n, 1n << 200n, 3n]] as const) {
      const range = createRange(start, stop, step), key = v.tuple([v.integer(range.length), range.length === 0n ? v.none : v.integer(start), range.length <= 1n ? v.none : v.integer(step)]);
      expect(runtimeHash(v.range(range), context, meter)).toBe(constantHash(key, context, meter));
    }
    expect(runtimeHash(v.range(createRange(0n, 4n, 2n)), context, meter)).toBe(runtimeHash(v.range(createRange(0n, 3n, 2n)), context, meter));
  });
  it("combines nested ranges with immutable tuple and slice keys", () => {
    const { meter, v, context } = fixture(), a = v.range(createRange(0n, 4n, 2n)), b = v.range(createRange(0n, 3n, 2n));
    expect(runtimeHash(v.tuple([v.slice({ lower: a })]), context, meter)).toBe(runtimeHash(v.tuple([v.slice({ lower: b })]), context, meter));
  });
  it("checks fatal budgets before publishing trusted identity hashes", () => {
    const { v, context } = fixture(), iterator = v.iterator({ next: () => ({ done: true, value: undefined }) });
    const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000, signal: controller.signal });
    expect(() => runtimeHash(iterator, { ...context, identity: () => { controller.abort(); return 1n; } }, meter)).toThrow(ExecutionLimitError);
  });
});
