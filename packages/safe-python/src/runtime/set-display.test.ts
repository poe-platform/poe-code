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
    store: unused, unary: unused, binary: unused, compare: unused, attribute: unused, slice: unused, beginCall: unused,
    truth: Boolean, boolean: value => value, tuple: unused, list: values => [...values], getItem: unused, iterate: unused,
    beginSet: values => {
      events.push("create");
      const set = new Set<unknown>();
      const add = (value: unknown) => { events.push(`add:${value}`); if (value === "bad") throw new Error("hash failed"); set.add(value); };
      for (const value of values) add(value);
      return {
        add,
        update: value => { events.push("update"); for (const item of value as Iterable<unknown>) add(item); },
        finish: () => { events.push("finish"); return set; }
      };
    }
  };
  return { context, events };
}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

describe("set display execution", () => {
  it("evaluates the small initial group before inserting its values", () => {
    const { context, events } = environment({ a: 1, b: 2 });
    expect(evaluateExpression(parseExpression("{a, b, a}"), context, budget())).toEqual(new Set([1, 2]));
    expect(events).toEqual(["load:a", "load:b", "load:a", "create", "add:1", "add:2", "add:1", "finish"]);
  });

  it("inserts the initial group before evaluating a star and later items individually", () => {
    const { context, events } = environment({ a: 1, s: [2, 1], b: 3 });
    expect(evaluateExpression(parseExpression("{a, *s, b}"), context, budget())).toEqual(new Set([1, 2, 3]));
    expect(events).toEqual(["load:a", "create", "add:1", "load:s", "update", "add:2", "add:1", "load:b", "add:3", "finish"]);
  });

  it("supports an empty starred set and fresh repeated displays", () => {
    const { context } = environment({ s: [] });
    const node = parseExpression("{*s}");
    const first = evaluateExpression(node, context, budget());
    const second = evaluateExpression(node, context, budget());
    expect(first).toEqual(new Set());
    expect(second).toEqual(new Set());
    expect(first).not.toBe(second);
  });

  it.each([30, 31])("matches insertion scheduling at the %i-item boundary", count => {
    const { context, events } = environment({ a: 1 });
    evaluateExpression(parseExpression(`{${Array(count).fill("a").join(",")}}`), context, budget());
    expect(events.slice(0, count === 30 ? 3 : 5)).toEqual(count === 30 ? ["load:a", "load:a", "load:a"] : ["create", "load:a", "add:1", "load:a", "add:1"]);
  });

  it("stops before a star expression when initial hashing fails", () => {
    const { context, events } = environment({ a: "bad", b: 2 });
    expect(() => evaluateExpression(parseExpression("{a, b, *missing}"), context, budget())).toThrow("hash failed");
    expect(events).toEqual(["load:a", "load:b", "create", "add:bad"]);
  });

  it("propagates update failure before evaluating subsequent expressions", () => {
    const { context, events } = environment({ s: [1, "bad"] });
    expect(() => evaluateExpression(parseExpression("{*s, missing}"), context, budget())).toThrow("hash failed");
    expect(events).toEqual(["create", "load:s", "update", "add:1", "add:bad"]);
  });

  it("checks the budget before set construction or hashing", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("{*missing}"), context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 10000 }))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
  });
});
