import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";

function environment(initial: Record<string, unknown> = {}) {
  const events: string[] = [], names = new Map(Object.entries(initial));
  const unused = () => { throw new Error("unused fixture operation"); };
  const context: ExpressionContext<unknown> = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name); },
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    unary: unused, binary: unused, compare: unused, attribute: unused, slice: unused, beginCall: unused,
    truth: Boolean, boolean: value => value,
    tuple: values => { events.push("tuple"); return { tuple: values }; },
    list: values => { events.push("list"); return [...values]; },
    getItem: (object, key) => (object as unknown[])[Number(key)],
    iterate: value => {
      events.push("iterate");
      const iterator = (value as Iterable<unknown>)[Symbol.iterator]();
      return { next: () => { events.push("next"); return iterator.next(); } };
    }
  };
  return { context, events, names };
}
const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });

describe("tuple and list display execution", () => {
  it.each(["[a, b]", "(a, b)"])("evaluates display items left to right: %s", source => {
    const { context, events } = environment({ a: 1, b: 2 });
    expect(evaluateExpression(parseExpression(source), context, budget())).toEqual(source[0] === "[" ? [1, 2] : { tuple: [1, 2] });
    expect(events).toEqual(["load:a", "load:b", source[0] === "[" ? "list" : "tuple"]);
  });

  it("distinguishes grouping, singleton tuples and empty displays", () => {
    const { context } = environment({ a: 1 });
    expect(evaluateExpression(parseExpression("(a)"), context, budget())).toBe(1);
    expect(evaluateExpression(parseExpression("(a,)"), context, budget())).toEqual({ tuple: [1] });
    expect(evaluateExpression(parseExpression("()"), context, budget())).toEqual({ tuple: [] });
    expect(evaluateExpression(parseExpression("[]"), context, budget())).toEqual([]);
  });

  it.each(["[a, *s, b]", "(a, *s, b)"])("consumes unpacking before later elements: %s", source => {
    const { context, events } = environment({ a: 1, s: [2, 3], b: 4 });
    const result = evaluateExpression(parseExpression(source), context, budget());
    expect(result).toEqual(source[0] === "[" ? [1, 2, 3, 4] : { tuple: [1, 2, 3, 4] });
    expect(events).toEqual(["load:a", "load:s", "iterate", "next", "next", "next", "load:b", source[0] === "[" ? "list" : "tuple"]);
  });

  it("handles empty and multiple unpackings", () => {
    const { context } = environment({ a: [], b: [1, 2] });
    expect(evaluateExpression(parseExpression("[*a, *b, *a, *b]"), context, budget())).toEqual([1, 2, 1, 2]);
  });

  it("preserves element identity and creates fresh list displays", () => {
    const item = {}, { context } = environment({ item });
    const node = parseExpression("[item]");
    const first = evaluateExpression(node, context, budget()) as unknown[];
    const second = evaluateExpression(node, context, budget()) as unknown[];
    expect(first).not.toBe(second);
    expect(first[0]).toBe(item);
    expect(second[0]).toBe(item);
  });

  it("supports nested displays, walrus values and immediate indexing", () => {
    const { context, names } = environment();
    expect(evaluateExpression(parseExpression("[(x := 7), [x]][1][0]"), context, budget())).toBe(7n);
    expect(names.get("x")).toBe(7n);
  });

  it("propagates expansion failures without later evaluation or publishing a result", () => {
    const { context, events } = environment({ s: null });
    expect(() => evaluateExpression(parseExpression("[*s, missing]"), context, budget())).toThrow(TypeError);
    expect(events).toEqual(["load:s", "iterate"]);
  });

  it("evaluates deeply nested display ASTs without host recursion", () => {
    const leaf = parseExpression("1");
    let node: Expression = leaf;
    for (let depth = 0; depth < 5000; depth++) node = { ...leaf, kind: "list", items: [node] };
    let result = evaluateExpression(node, environment().context, budget());
    for (let depth = 0; depth < 5000; depth++) result = (result as unknown[])[0];
    expect(result).toBe(1n);
  });

  it("meters infinite display unpacking and leaves iterator cleanup to its owner", () => {
    const { context, events } = environment({ s: {} });
    let closed = false;
    context.iterate = () => ({ next: () => ({ done: false, value: 1 }), return: () => { closed = true; return { done: true, value: undefined }; } });
    expect(() => evaluateExpression(parseExpression("[*s]"), context, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(closed).toBe(false);
    expect(events).not.toContain("list");
  });
});
