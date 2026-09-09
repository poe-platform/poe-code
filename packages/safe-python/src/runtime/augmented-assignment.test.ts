import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { ExecutionBudget } from "./execution-budget.js";
import { executeAugmentedAssignment, type AugmentedAssignmentContext } from "./augmented-assignment.js";

function statement(source = "obj[key] += rhs") {
  const node = parseModule(source).body[0];
  if (node.kind !== "augmented-assignment") throw new Error("invalid fixture");
  return node;
}

function fixture(failure?: string) {
  const events: string[] = [], old = [1], replacement = [7];
  let slot = old;
  const step = (name: string) => { events.push(name); if (failure === name) throw new Error(name); };
  const context: AugmentedAssignmentContext<number[]> = {
    resolve: () => {
      step("resolve");
      return { get: () => { step("get"); return slot; }, set: value => { step("set"); slot = value; } };
    },
    evaluate: () => { step("rhs"); slot = replacement; return [2]; },
    inplace: (operator, left, right) => { step("inplace"); expect(operator).toBe("+"); left.push(...right); return left; }
  };
  return { context, events, old, replacement, slot: () => slot };
}
const budget = (maxSteps = 100) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 1000 });

describe("augmented assignment execution", () => {
  it.each(["a += rhs", "obj.x += rhs", "obj[key] += rhs"])("loads before RHS and writes to the retained target: %s", source => {
    const state = fixture();
    executeAugmentedAssignment(statement(source), state.context, budget());
    expect(state.events).toEqual(["resolve", "get", "rhs", "inplace", "set"]);
    expect(state.old).toEqual([1, 2]);
    expect(state.slot()).toBe(state.old);
    expect(state.replacement).toEqual([7]);
  });

  it.each(["resolve", "get", "rhs", "inplace", "set"])("stops at a %s failure without rollback", failure => {
    const state = fixture(failure), order = ["resolve", "get", "rhs", "inplace", "set"];
    expect(() => executeAugmentedAssignment(statement(), state.context, budget())).toThrow(failure);
    expect(state.events).toEqual(order.slice(0, order.indexOf(failure) + 1));
    expect(state.old).toEqual(failure === "set" ? [1, 2] : [1]);
    expect(state.slot()).toBe(["inplace", "set"].includes(failure) ? state.replacement : state.old);
  });

  it.each([0, 1, 2, 3, 4])("checks limits before each guest operation with %i available steps", limit => {
    const state = fixture();
    expect(() => executeAugmentedAssignment(statement(), state.context, budget(limit))).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["resolve", "get", "rhs", "inplace", "set"].slice(0, limit));
    expect(state.old).toEqual(limit === 4 ? [1, 2] : [1]);
  });

  it.each(["+", "-", "*", "@", "/", "//", "%", "**", "<<", ">>", "&", "^", "|"])("passes %s to guest in-place dispatch", operator => {
    const calls: unknown[] = [];
    executeAugmentedAssignment(statement(`x ${operator}= rhs`), {
      resolve: () => ({ get: () => undefined, set: value => calls.push(value) }),
      evaluate: () => undefined,
      inplace: (op, left, right) => { calls.push(op, left, right); return undefined; }
    }, budget());
    expect(calls).toEqual([operator, undefined, undefined, undefined]);
  });
});
