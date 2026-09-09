import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture(names: Record<string, unknown>) {
  const events: string[] = [], meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
  const context = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!(name in names)) throw new Error("missing"); return names[name]; },
    tuple: items => { events.push("tuple"); return items; },
    slice: parts => { events.push("slice"); return parts; },
    iterate: value => (value as unknown[])[Symbol.iterator](),
    getItem: (object, key) => { events.push("get"); return (object as unknown[])[key as number]; }
  } as ExpressionContext<unknown>;
  return { events, context, meter, resolve(source: string) {
    const node = parseExpression(source); if (node.kind !== "subscript") throw new Error("fixture");
    return evaluateExpression(node, context, meter, "subscript-reference");
  } };
}

describe("subscript reference evaluation", () => {
  it("captures a receiver and key without reading the target", () => {
    const object = {}, state = fixture({ object, key: 2 });
    expect(state.resolve("object[key]")).toEqual({ object, key: 2 });
    expect(state.events).toEqual(["load:object", "load:key"]);
  });
  it("still reads nested subscriptions in receivers and slice bounds", () => {
    const target = {}, state = fixture({ objects: [target], indices: [0], bounds: [2], stop: 7 });
    expect(state.resolve("objects[indices[0]][bounds[0]:stop]")).toEqual({ object: target, key: { lower: 2, upper: 7 } });
    expect(state.events).toEqual(["load:objects", "load:indices", "get", "get", "load:bounds", "get", "load:stop", "slice"]);
  });
  it("retains starred and comma key construction", () => {
    const object = {}, state = fixture({ object, keys: [1, 2], stop: 5 });
    expect(state.resolve("object[*keys, :stop]")).toEqual({ object, key: [1, 2, { upper: 5 }] });
    expect(state.events).toEqual(["load:object", "load:keys", "load:stop", "slice", "tuple"]);
  });
  it("preserves undefined host representations and defers receiver validation", () => {
    const state = fixture({ object: undefined, key: undefined });
    expect(state.resolve("object[key]")).toEqual({ object: undefined, key: undefined });
    expect(state.events).not.toContain("get");
  });
  it("stops on key evaluation failure without reading the outer target", () => {
    const state = fixture({ object: {} });
    expect(() => state.resolve("object[missing]")).toThrow("missing");
    expect(state.events).toEqual(["load:object", "load:missing"]);
  });
});
