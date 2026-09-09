import { describe, expect, it } from "vitest";
import { createRuntimeExpressionContext, type RuntimeExpressionBindings } from "./runtime-expression-context.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { evaluateExpression, UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const names = new Map<string, RuntimeValue>(), events: string[] = [];
  const bindings: RuntimeExpressionBindings & { names: typeof names; events: string[] } = {
    names, events,
    load(name) { this.events.push(`load:${name}`); const value = this.names.get(name); if (value === undefined) throw new Error(`missing:${name}`); return value; },
    store(name, value) { this.events.push(`store:${name}`); this.names.set(name, value); },
    attribute(object, name) { this.events.push(`attribute:${name}`); return object; },
    beginCall(callee) { this.events.push("prepare"); const args: RuntimeValue[] = []; return {
      positional: value => { args.push(value); }, starred: () => { throw new Error("unused"); },
      keywords: () => { throw new Error("unused"); }, mapping: () => { throw new Error("unused"); },
      invoke: () => { this.events.push("invoke"); return v.tuple([callee, ...args]); }
    }; },
    beginSet() { throw new UnsupportedExpressionError("set"); },
    beginDictionary() { throw new UnsupportedExpressionError("dictionary"); },
    warn(category) { this.events.push(category); }
  };
  const context = createRuntimeExpressionContext(v, bindings, meter);
  return { meter, v, names, events, bindings, context, run: (source: string) => evaluateExpression(parseExpression(source), context, meter) };
}

describe("concrete runtime expression context", () => {
  it("assembles arithmetic, subscription, comparison and membership", () => {
    const { v, run } = fixture();
    expect(run("([1, 2] + [3] * 2)[-1]")).toEqual(v.integer(3));
    expect(run("[1, [2]] < [1, [3]]")).toBe(v.true);
    expect(run("[1] in [[1], [2]]")).toBe(v.true);
    expect(run("not [] and 0 not in []")).toBe(v.true);
    expect(run("(*[1, 2], *b'a')")).toEqual(v.tuple([v.integer(1), v.integer(2), v.integer(97)]));
  });
  it("binds namespace methods to their owner and supports named expressions", () => {
    const { names, events, run, v } = fixture();
    expect(events).toEqual([]);
    expect(run("(x := [1])[0]")).toEqual(v.integer(1));
    expect(run("x[0]")).toEqual(v.integer(1));
    expect(names.get("x")?.kind).toBe("list"); expect(events).toEqual(["store:x", "load:x"]);
  });
  it("delegates object/call hooks only during expression execution", () => {
    const { names, events, run, v } = fixture(); names.set("f", v.none);
    expect(run("f.member(1, 2)")).toEqual(v.tuple([v.none, v.integer(1), v.integer(2)]));
    expect(events).toEqual(["load:f", "attribute:member", "prepare", "invoke"]);
  });
  it("preserves branching short circuit and the warning hook receiver", () => {
    const { run, context, meter, events, v } = fixture();
    expect(run("[] and missing")).toMatchObject({ kind: "list" });
    expect(evaluateExpression(parseExpression("[] and missing"), context, meter, "branch")).toBe(false);
    expect(run("~True")).toEqual(v.integer(-2)); expect(events).toEqual(["DeprecationWarning"]);
  });
  it("never publishes declined binary operations as successful values", () => {
    const { run } = fixture();
    expect(() => run("None + 1")).toThrow(UnsupportedExpressionError);
    expect(() => run("2.0 ** 0.5")).toThrow(UnsupportedExpressionError);
    expect(() => run("1 / 0")).toThrow("division by zero");
  });
  it("retains explicit unsupported object operations rather than inventing defaults", () => {
    const { run } = fixture();
    expect(() => run("{1}")).toThrow(UnsupportedExpressionError);
    expect(() => run("{}" )).toThrow(UnsupportedExpressionError);
    expect(() => run("lambda: 1")).toThrow(UnsupportedExpressionError);
  });
  it("charges setup before binding a context", () => {
    const { v, bindings } = fixture();
    expect(() => createRuntimeExpressionContext(v, bindings, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
