import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { createFunctionState } from "./function-state.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeBinary } from "./runtime-binary.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const program = compileProgram(analyzeModule("def f(self):\n return self\n"), { stripDocstring: false }, v, meter);
  const state = createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter);
  return { v, meter, fn: v.function(state) };
}

describe("concrete bound Python methods", () => {
  it("merges equivalent method dictionary keys while retaining the first wrapper", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]), first = v.boundMethod(fn, instance);
    const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
    const map = new OrderedKeyMap<typeof first, boolean>({ hash: key => runtimeHash(key, hash, meter), equal: (a, b) => runtimeComparison("==", a, b, v, meter).value }, meter);
    map.set(first, false); map.set(v.boundMethod(fn, instance), true); map.set(v.boundMethod(fn, v.list([])), false);
    expect(map.size).toBe(2); expect(map.snapshot()[0]).toEqual([first, true]); expect(map.snapshot()[0][0]).toBe(first);
  });
  it("retains function and instance references without executing the body", () => {
    const { v, fn } = fixture(), instance = v.list([]), method = v.boundMethod(fn, instance);
    expect(method.kind).toBe("method"); expect(method.value.function).toBe(fn); expect(method.value.instance).toBe(instance);
    expect(Object.isFrozen(method)).toBe(true); expect(Object.isFrozen(method.value)).toBe(true);
    expect(() => v.boundMethod(fn, v.none)).toThrow("instance must not be None");
  });
  it("compares function and instance identities instead of instance equality", () => {
    const { v, meter, fn } = fixture(), a = v.list([]), b = v.list([]), first = v.boundMethod(fn, a);
    expect(runtimeComparison("==", first, v.boundMethod(fn, a), v, meter)).toBe(v.true);
    expect(runtimeComparison("!=", first, v.boundMethod(fn, b), v, meter)).toBe(v.true);
    expect(runtimeComparison("==", first, v.boundMethod(v.function(fn.value), a), v, meter)).toBe(v.false);
  });
  it("hashes unhashable instances by identity, xor the function hash", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]), method = v.boundMethod(fn, instance);
    const context = { none: v.none, identity: (value: unknown) => value === fn ? 101n : value === instance ? 33n : 99n, string: () => 0n, bytes: () => 0n };
    expect(runtimeHash(method, context, meter)).toBe(68n);
    expect(runtimeHash(v.boundMethod(fn, instance), context, meter)).toBe(68n);
    expect(runtimeHash(method, { ...context, identity: value => value === fn ? 3n : -4n }, meter)).toBe(-2n);
  });
  it("is truthy, rejects iteration and declines numeric operations", () => {
    const { v, meter, fn } = fixture(), method = v.boundMethod(fn, v.list([]));
    expect(runtimeTruth(method, meter)).toBe(true);
    expect(() => runtimeIterate(method, v, meter)).toThrow("'method' object is not iterable");
    expect(runtimeBinary("+", method, v.integer(1), v, meter)).toBe(v.notImplemented);
  });

  it("compares wrapped values by equality but receivers only by identity", () => {
    const { v, meter } = fixture(), receiver = v.list([]), other = v.list([]), a = v.list([v.integer(1)]), b = v.list([v.integer(1)]);
    expect(runtimeComparison("==", v.boundMethod(a, receiver), v.boundMethod(b, receiver), v, meter)).toBe(v.true);
    expect(runtimeComparison("!=", v.boundMethod(a, receiver), v.boundMethod(b, other), v, meter)).toBe(v.true);
  });

  it("truth-converts callable equality before applying receiver identity", () => {
    const { v, meter } = fixture(), a = v.cell({}), b = v.cell({}), receiver = v.list([]), events: string[] = [];
    const context = { equality(left: unknown, right: unknown) { expect(left).toBe(a); expect(right).toBe(b); events.push("eq"); return v.integer(7); }, truth(value: unknown) { expect(value).toEqual(v.integer(7)); events.push("truth"); return true; } };
    expect(runtimeComparison("==", v.boundMethod(a, receiver), v.boundMethod(b, v.list([])), v, meter, 1000, context)).toBe(v.false);
    expect(events).toEqual(["eq", "truth"]);
  });

  it("hashes the wrapped value rather than its identity and rejects unhashable wrapped values", () => {
    const { v, meter } = fixture(), receiver = v.list([]), context = { none: v.none, identity: () => 33n, string: () => 0n, bytes: () => 0n };
    expect(runtimeHash(v.boundMethod(v.integer(7), receiver), context, meter)).toBe(38n);
    expect(() => runtimeHash(v.boundMethod(v.list([]), receiver), context, meter)).toThrow("unhashable type: 'list'");
  });

  it("hashes deeply nested method bindings without recursive host calls", () => {
    const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
    let method: RuntimeValue = v.integer(7);
    for (let depth = 0; depth < 2000; depth++) method = v.boundMethod(method, v.true);
    expect(runtimeHash(method, { none: v.none, identity: () => 33n, string: () => 0n, bytes: () => 0n }, meter)).toBe(7n);
  });

  it("skips callable equality for identical wrapped values", () => {
    const { v, meter } = fixture(), fn = v.cell({}), receiver = v.list([]);
    const context = { equality() { throw Error("must not compare identical callable"); } };
    expect(runtimeComparison("==", v.boundMethod(fn, receiver), v.boundMethod(fn, receiver), v, meter, 1000, context)).toBe(v.true);
  });

  it("bounds recursive method equality with the comparison depth policy", () => {
    const { v, meter } = fixture(); let a: RuntimeValue = v.list([]), b: RuntimeValue = v.list([]);
    for (let depth = 0; depth < 20; depth++) { a = v.boundMethod(a, v.true); b = v.boundMethod(b, v.true); }
    expect(() => runtimeComparison("==", a, b, v, meter, 10)).toThrow("maximum recursion depth exceeded in comparison");
  });

  it("runs the callable hash before the receiver identity hash", () => {
    const { v, meter } = fixture(), fn = v.cell({}), receiver = v.list([]), events: string[] = [];
    const guest = { lookupHash: () => () => { events.push("callable hash"); return v.integer(7); }, integer: (value: RuntimeValue) => value.kind === "int" ? value.value : undefined, typeName: () => "Callable" };
    const context = { none: v.none, guestHash: (value: RuntimeValue) => value === fn ? guest : undefined, identity(value: RuntimeValue) { expect(value).toBe(receiver); events.push("receiver identity"); return 33n; }, string: () => 0n, bytes: () => 0n };
    expect(runtimeHash(v.boundMethod(fn, receiver), context, meter)).toBe(38n); expect(events).toEqual(["callable hash", "receiver identity"]);
  });
});
