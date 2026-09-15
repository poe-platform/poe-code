import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";

function environment(initial: Record<string, unknown> = {}) {
  const events: string[] = [], names = new Map(Object.entries({ obj: {}, ...initial }));
  const unused = () => { throw new Error("unused fixture operation"); };
  const context: ExpressionContext<unknown> = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name); },
    store: unused, unary: unused, binary: unused, compare: unused, truth: Boolean, boolean: value => value, attribute: unused, beginCall: unused,
    tuple: values => { events.push("tuple"); return { tuple: values }; },
    list: values => [...values],
    beginSet: unused,
    beginDictionary: unused,
    slice: parts => { events.push("slice"); return { slice: [parts.lower ?? null, parts.upper ?? null, parts.step ?? null] }; },
    getItem: (_object, key) => { events.push("getitem"); return key; },
    iterate: value => {
      events.push("iterate");
      const iterator = (value as Iterable<unknown>)[Symbol.iterator]();
      return { next: () => { events.push("next"); return iterator.next(); } };
    }
  };
  return { context, events };
}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

describe("subscription expression execution", () => {
  it("evaluates the object before the index and invokes getitem last", () => {
    const { context, events } = environment({ a: 3 });
    expect(evaluateExpression(parseExpression("obj[a]"), context, budget())).toBe(3);
    expect(events).toEqual(["load:obj", "load:a", "getitem"]);
  });

  it("constructs slices after lower, upper and step evaluation in that order", () => {
    const { context, events } = environment({ a: 1, b: 7, c: 2 });
    expect(evaluateExpression(parseExpression("obj[a:b:c]"), context, budget())).toEqual({ slice: [1, 7, 2] });
    expect(events).toEqual(["load:obj", "load:a", "load:b", "load:c", "slice", "getitem"]);
  });

  it.each(["obj[:]", "obj[::]"])("passes absent slice parts without evaluating them: %s", source => {
    const { context, events } = environment();
    expect(evaluateExpression(parseExpression(source), context, budget())).toEqual({ slice: [null, null, null] });
    expect(events).toEqual(["load:obj", "slice", "getitem"]);
  });

  it("distinguishes a present undefined slice value from an absent bound", () => {
    const { context } = environment({ a: undefined });
    context.slice = parts => Object.hasOwn(parts, "lower");
    expect(evaluateExpression(parseExpression("obj[a:]"), context, budget())).toBe(true);
    expect(evaluateExpression(parseExpression("obj[:]"), context, budget())).toBe(false);
  });

  it("preserves slice values without index conversion or rejecting a zero step", () => {
    const { context } = environment({ a: "bound", b: {}, c: 0 });
    expect(evaluateExpression(parseExpression("obj[a:b:c]"), context, budget())).toEqual({ slice: ["bound", {}, 0] });
  });

  it("packs comma-separated keys, including a trailing-comma singleton", () => {
    const { context } = environment({ a: 1 });
    expect(evaluateExpression(parseExpression("obj[a,]"), context, budget())).toEqual({ tuple: [1] });
    expect(evaluateExpression(parseExpression("obj[a, :]"), context, budget())).toEqual({ tuple: [1, { slice: [null, null, null] }] });
  });

  it("consumes starred index values before evaluating later index items", () => {
    const { context, events } = environment({ a: 1, s: [2, 3], b: 4 });
    expect(evaluateExpression(parseExpression("obj[a, *s, :b]"), context, budget())).toEqual({ tuple: [1, 2, 3, { slice: [null, 4, null] }] });
    expect(events).toEqual(["load:obj", "load:a", "load:s", "iterate", "next", "next", "next", "load:b", "slice", "tuple", "getitem"]);
  });

  it("constructs an empty tuple for an empty starred key", () => {
    const { context } = environment({ s: [] });
    expect(evaluateExpression(parseExpression("obj[*s]"), context, budget())).toEqual({ tuple: [] });
  });

  it("does not continue after an operand or iterator fails", () => {
    const { context, events } = environment({ s: 1 });
    expect(() => evaluateExpression(parseExpression("obj[*s, missing]"), context, budget())).toThrow(TypeError);
    expect(events).toEqual(["load:obj", "load:s", "iterate"]);
    events.length = 0;
    expect(() => evaluateExpression(parseExpression("obj[:missing]"), context, budget())).toThrow("missing:missing");
    expect(events).toEqual(["load:obj", "load:missing"]);
  });

  it("bounds infinite unpacking without closing the caller-owned iterator", () => {
    const { context, events } = environment({ s: {} });
    let count = 0, closed = false;
    context.iterate = () => ({ next: () => { count++; return { done: false, value: count }; }, return: () => { closed = true; return { done: true, value: null }; } });
    expect(() => evaluateExpression(parseExpression("obj[*s]"), context, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toThrow("execution step limit exceeded");
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    expect(closed).toBe(false);
    expect(events).not.toContain("getitem");
  });
});
