import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { evaluateCallArguments, type ExpressionCall } from "./call-arguments.js";

function fixture(source: string, prefix = false) {
  const node = parseExpression(source);
  if (node.kind !== "call") throw new Error("expected call");
  const events: string[] = [], positional: unknown[] = [], keywords = new Map<string, unknown>();
  const call: ExpressionCall<unknown> = {
    positional: value => { events.push(`pos:${value}`); positional.push(value); },
    starred: value => { events.push(`star:${value}`); positional.push(value); },
    keywords: entries => {
      events.push("keywords");
      for (const [key, value] of entries) {
        if (keywords.has(key)) throw new Error(`duplicate:${key}`);
        keywords.set(key, value);
      }
    },
    mapping: value => { events.push(`mapping:${value}`); keywords.set("x", value); },
    invoke: () => { events.push("invoke"); return { positional, keywords }; }
  };
  const run = (maxSteps = 10000) => {
    const evaluation = evaluateCallArguments(node.arguments, call, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 }), prefix);
    let step = evaluation.next();
    while (!step.done) {
      if (step.value.kind !== "name") throw new Error("unexpected operand");
      events.push(`eval:${step.value.name}`);
      step = evaluation.next(step.value.name);
    }
    return step.value;
  };
  return { call, events, run };
}

describe("shared call argument evaluation", () => {
  it("defers a lone star for ordinary calls", () => {
    const state = fixture("f(x=keyword, *items)");
    state.run();
    expect(state.events).toEqual(["eval:items", "eval:keyword", "keywords", "star:items", "invoke"]);
  });

  it("expands a lone star before keywords when implicit positional arguments exist", () => {
    const state = fixture("f(x=keyword, *items)", true);
    state.run();
    expect(state.events).toEqual(["eval:items", "star:items", "eval:keyword", "keywords", "invoke"]);
  });

  it("evaluates all positional/starred operands before syntactically earlier keywords", () => {
    const state = fixture("f(first, x=keyword, *items, *other)");
    state.run();
    expect(state.events).toEqual(["eval:first", "pos:first", "eval:items", "star:items", "eval:other", "star:other", "eval:keyword", "keywords", "invoke"]);
  });

  it("merges an entire explicit keyword group before evaluating the next mapping", () => {
    const state = fixture("f(x=one, y=two, **mapping)");
    state.run();
    expect(state.events).toEqual(["eval:one", "eval:two", "keywords", "eval:mapping", "mapping:mapping", "invoke"]);
  });

  it("evaluates all keyword group values before a duplicate failure", () => {
    const state = fixture("f(*items, **mapping, x=one, y=two)");
    expect(() => state.run()).toThrow("duplicate:x");
    expect(state.events).toEqual(["eval:items", "eval:mapping", "mapping:mapping", "eval:one", "eval:two", "keywords"]);
  });

  it("stops a prefixed call at a failed star before evaluating keywords", () => {
    const state = fixture("f(*items, x=keyword)", true);
    const error = new Error("iteration failed");
    state.call.starred = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.events).toEqual(["eval:items"]);
  });

  it("preserves undefined yielded values and invocation results", () => {
    const node = parseExpression("f(*items)");
    if (node.kind !== "call") throw new Error("expected call");
    const state = fixture("f()");
    let seen: unknown = 1;
    state.call.starred = value => { seen = value; };
    state.call.invoke = () => undefined;
    const evaluation = evaluateCallArguments(node.arguments, state.call, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 }));
    expect(evaluation.next().done).toBe(false);
    expect(evaluation.next(undefined)).toEqual({ done: true, value: undefined });
    expect(seen).toBeUndefined();
  });

  it("checks limits before exposing any expression or collector effect", () => {
    const state = fixture("f(a)");
    expect(() => state.run(0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
});
