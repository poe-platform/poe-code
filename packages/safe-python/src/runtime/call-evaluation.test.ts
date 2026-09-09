import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";
import { bindArguments } from "./argument-binding.js";

function environment(initial: Record<string, unknown> = {}) {
  const events: string[] = [];
  const capture = (positional: unknown[], keywords: Map<string, unknown>) => ({ positional, keywords });
  const names = new Map<string, unknown>(Object.entries({ f: capture, ...initial }));
  const context: ExpressionContext<unknown> = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name); },
    store: (name, value) => { names.set(name, value); },
    truth: value => Boolean(value), boolean: value => value,
    unary: () => { throw new Error("unused"); }, binary: () => { throw new Error("unused"); }, compare: () => { throw new Error("unused"); }, attribute: () => { throw new Error("unused"); },
    tuple: () => { throw new Error("unused"); }, slice: () => { throw new Error("unused"); }, getItem: () => { throw new Error("unused"); }, iterate: () => { throw new Error("unused"); },
    list: values => [...values],
    beginCall: callee => {
      const positional: unknown[] = [], keywords = new Map<string, unknown>();
      const merge = (entries: Iterable<readonly [string, unknown]>) => {
        for (const [key, value] of entries) {
          if (keywords.has(key)) throw new Error(`duplicate:${key}`);
          keywords.set(key, value);
        }
      };
      return {
        positional: value => { positional.push(value); },
        starred: value => { events.push("iterate"); positional.push(...value as unknown[]); },
        keywords: entries => { events.push("keywords"); merge(entries); },
        mapping: value => { events.push("mapping"); merge(value as Map<string, unknown>); },
        invoke: () => { events.push("invoke"); return (callee as typeof capture)(positional, keywords); }
      };
    }
  };
  return { context, events, names };
}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

describe("call expression evaluation", () => {
  it("evaluates the callee and positional values before keyword values", () => {
    const { context, events } = environment({ a: 1, b: 2, c: 3 });
    expect(evaluateExpression(parseExpression("f(a, b, x=c)"), context, budget())).toEqual({ positional: [1, 2], keywords: new Map([["x", 3]]) });
    expect(events).toEqual(["load:f", "load:a", "load:b", "load:c", "keywords", "invoke"]);
  });

  it("processes star expressions before syntactically earlier keywords", () => {
    const { context, events } = environment({ a: 1, s: [2], t: [3], b: 4 });
    expect(evaluateExpression(parseExpression("f(a, x=b, *s, *t)"), context, budget())).toEqual({ positional: [1, 2, 3], keywords: new Map([["x", 4]]) });
    expect(events).toEqual(["load:f", "load:a", "load:s", "iterate", "load:t", "iterate", "load:b", "keywords", "invoke"]);
  });

  it("defers expansion of a sole starred positional operand until after keywords", () => {
    const { context, events } = environment({ s: [2], b: 4 });
    evaluateExpression(parseExpression("f(x=b, *s)"), context, budget());
    expect(events).toEqual(["load:f", "load:s", "load:b", "keywords", "iterate", "invoke"]);
  });

  it("evaluates a whole explicit keyword group before merging it", () => {
    const { context, events } = environment({ m: new Map([["x", 0]]), a: 1, b: 2 });
    expect(() => evaluateExpression(parseExpression("f(**m, x=a, y=b)"), context, budget())).toThrow("duplicate:x");
    expect(events).toEqual(["load:f", "load:m", "mapping", "load:a", "load:b", "keywords"]);
  });

  it("stops at a failed mapping merge before later expressions or deferred star expansion", () => {
    const { context, events } = environment({ s: [1], m: new Map([["x", 0]]), n: new Map([["x", 1]]) });
    expect(() => evaluateExpression(parseExpression("f(*s, **m, **n, y=missing)"), context, budget())).toThrow("duplicate:x");
    expect(events).toEqual(["load:f", "load:s", "load:m", "mapping", "load:n", "mapping"]);
  });

  it("does not validate callability before evaluating arguments", () => {
    const { context, events } = environment({ f: null, a: 1 });
    expect(() => evaluateExpression(parseExpression("f(a)"), context, budget())).toThrow(TypeError);
    expect(events).toEqual(["load:f", "load:a", "invoke"]);
  });

  it("keeps nested call state independent", () => {
    const { context } = environment();
    expect(evaluateExpression(parseExpression("f(f(1), x=f(2))"), context, budget())).toEqual({
      positional: [{ positional: [1n], keywords: new Map() }],
      keywords: new Map([["x", { positional: [2n], keywords: new Map() }]])
    });
  });

  it("can invoke the runtime binder with evaluated arguments", () => {
    const { context } = environment({ f: (args: unknown[], keywords: Map<string, unknown>) => bindArguments("f", [
      { name: "a", kind: "positional-only" }, { name: "b", kind: "keyword-only" }
    ], args, keywords).values });
    expect(evaluateExpression(parseExpression("f(1, b=2)"), context, budget())).toEqual(new Map([["a", 1n], ["b", 2n]]));
  });

  it("stops before callee lookup when the execution budget is exhausted", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("f()"), context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
  });
});
