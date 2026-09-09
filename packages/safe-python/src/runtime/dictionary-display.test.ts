import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";

function environment(initial: Record<string, unknown> = {}) {
  const events: string[] = [], names = new Map(Object.entries(initial));
  const unused = () => { throw new Error("unused fixture operation"); };
  const context: ExpressionContext<unknown> = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name); },
    store: unused, unary: unused, binary: unused, compare: unused, attribute: unused, slice: unused, beginCall: unused, beginSet: unused,
    truth: Boolean, boolean: value => value, tuple: unused, list: values => [...values], getItem: unused, iterate: unused,
    beginDictionary: entries => {
      events.push("create");
      const result = new Map<unknown, unknown>();
      const set = (key: unknown, value: unknown) => { events.push(`set:${key}`); if (key === "bad") throw new Error("hash failed"); result.set(key, value); };
      for (const [key, value] of entries) set(key, value);
      return {
        set,
        update: value => { events.push("update"); if (!(value instanceof Map)) throw new TypeError("not a mapping"); for (const [key, item] of value) result.set(key, item); },
        finish: () => result
      };
    }
  };
  return { context, events };
}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

describe("dictionary display execution", () => {
  it("evaluates key before value, batching small runs before hashing", () => {
    const { context, events } = environment({ a: "first", x: 1, b: "second", y: 2 });
    expect(evaluateExpression(parseExpression("{a:x, b:y}"), context, budget())).toEqual(new Map([["first", 1], ["second", 2]]));
    expect(events).toEqual(["load:a", "load:x", "load:b", "load:y", "create", "set:first", "set:second"]);
  });

  it("overwrites values while retaining first insertion order", () => {
    const { context } = environment({ a: "first", b: "second", m: new Map([["first", 3], ["third", 4]]) });
    const result = evaluateExpression(parseExpression("{a:1, b:2, **m, a:5}"), context, budget()) as Map<unknown, unknown>;
    expect([...result]).toEqual([["first", 5n], ["second", 2n], ["third", 4]]);
  });

  it("creates fresh empty dictionaries", () => {
    const { context } = environment(), node = parseExpression("{}");
    const first = evaluateExpression(node, context, budget());
    expect(first).toEqual(new Map());
    expect(evaluateExpression(node, context, budget())).not.toBe(first);
  });

  it("finishes each explicit run before evaluating the following mapping", () => {
    const { context, events } = environment({ a: "a", m: new Map(), b: "b" });
    evaluateExpression(parseExpression("{a:1, **m, b:2}"), context, budget());
    expect(events).toEqual(["load:a", "create", "set:a", "load:m", "update", "load:b", "create", "set:b", "update"]);
  });

  it.each([15, 16, 17, 18, 34])("preserves the %i-pair chunk schedule", count => {
    const { context, events } = environment({ k: "key", v: 1 });
    evaluateExpression(parseExpression(`{${Array(count).fill("k:v").join(",")}}`), context, budget());
    expect(events.slice(0, 4)).toEqual(count <= 15 ? ["load:k", "load:v", "load:k", "load:v"] : ["create", "load:k", "load:v", "set:key"]);
    expect(events.filter(event => event === "create")).toHaveLength(Math.ceil(count / 17));
  });

  it("does not evaluate a value whose key evaluation fails", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("{missing:later}"), context, budget())).toThrow("missing:missing");
    expect(events).toEqual(["load:missing"]);
  });

  it("stops before the following mapping when initial hashing fails", () => {
    const { context, events } = environment({ a: "bad", b: "b" });
    expect(() => evaluateExpression(parseExpression("{a:1, b:2, **missing}"), context, budget())).toThrow("hash failed");
    expect(events).toEqual(["load:a", "load:b", "create", "set:bad"]);
  });

  it("rejects failed mapping updates before later key expressions", () => {
    const { context, events } = environment({ m: null });
    expect(() => evaluateExpression(parseExpression("{**m, missing:1}"), context, budget())).toThrow("not a mapping");
    expect(events).toEqual(["create", "load:m", "update"]);
  });

  it("checks budgets before dictionary creation", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("{}"), context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
  });
});
