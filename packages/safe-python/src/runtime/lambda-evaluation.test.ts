import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";
import { evaluateExpression, UnsupportedExpressionError, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { invokeFunction } from "./function-invocation.js";
import { createFunctionState, type FunctionState } from "./function-state.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const names = new Map<string, unknown>(), events: string[] = [], created: { node: Expression; defaults: ReadonlyMap<string, unknown> }[] = [];
  const unexpected = (): never => { throw new Error("unexpected operation"); };
  const context: ExpressionContext<unknown> = {
    literal: node => node.value,
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name); },
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    unary: unexpected, binary: unexpected, compare: unexpected, boolean: value => value,
    truth: value => { events.push("truth"); return Boolean(value); },
    attribute: unexpected, beginCall: unexpected, tuple: unexpected, list: unexpected,
    beginSet: unexpected, beginDictionary: unexpected, slice: unexpected, getItem: unexpected, iterate: unexpected,
    createLambda: (node, defaults) => { events.push("create"); const value = { node, defaults }; created.push(value); return value; }
  };
  const run = (source: string, steps = 10000) => evaluateExpression(parseExpression(source), context, new ExecutionBudget({ maxSteps: steps, maxAllocatedBytes: 100000 }));
  return { names, events, created, context, run };
}

describe("lambda creation during expression evaluation", () => {
  it("creates and calls a lambda using its compiled code and captured defaults", () => {
    const state = fixture(), seed = {}, meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const analysis = analyzeModule("result=(lambda x=seed: x)()");
    const program = compileProgram<unknown>(analysis, { stripDocstring: false }, { string: value => value, integer: value => value, tuple: values => [...values] }, meter);
    state.names.set("seed", seed);
    state.context.createLambda = (node, defaults) => {
      const code = program.functions.get(node);
      if (code === undefined) throw new Error("missing lambda code");
      const value = createFunctionState(code, defaults, { globals: state.names, builtins: new Map(), none: null }, meter);
      state.names.set("seed", {});
      return value;
    };
    const calls = new CallStack<object>(10, meter);
    state.context.beginCall = value => {
      const callable = value as FunctionState<unknown>;
      const positional: unknown[] = [], keywords = new Map<string, unknown>();
      return {
        positional: value => { positional.push(value); },
        starred: () => { throw new Error("unexpected star"); },
        keywords: entries => { for (const [key, value] of entries) keywords.set(key, value); },
        mapping: () => { throw new Error("unexpected mapping"); },
        invoke: () => invokeFunction(callable.code, { name: "<lambda>", defaults: callable.defaults, positional, keywords }, {
          ...callable, calls, none: null,
          tuple: values => [...values], dictionary: values => new Map(values),
          body: frame => ({
            evaluate: expression => evaluateExpression(expression, { ...state.context, load: name => frame.load(name), store: (name, value) => frame.store(name, value) }, meter),
            test: () => false, iterate: () => [][Symbol.iterator](), assign: () => { throw new Error("unexpected assignment"); }, execute: () => { throw new Error("unexpected suite"); }
          })
        }, meter)
      };
    };
    const statement = analysis.module.body[0];
    if (statement.kind !== "assignment") throw new Error("expected assignment");
    expect(evaluateExpression(statement.value, state.context, meter)).toBe(seed);
    expect(calls.depth).toBe(0);
  });

  it("evaluates defaults in parameter order and leaves the body unexecuted", () => {
    const state = fixture(), first = {}, second = {};
    state.names.set("first", first); state.names.set("second", second);
    const result = state.run("lambda x=first, /, *args, y=second, **kwargs: missing");
    expect(state.events).toEqual(["load:first", "load:second", "create"]);
    expect(result).toBe(state.created[0]);
    expect([...state.created[0].defaults]).toEqual([["x", first], ["y", second]]);
  });
  it("preserves normalized unmangled parameter keys and undefined defaults", () => {
    const state = fixture(); state.names.set("value", undefined);
    state.run("lambda K=value, *, __private=value: missing");
    expect([...state.created[0].defaults]).toEqual([["K", undefined], ["__private", undefined]]);
  });
  it("creates a new defaults map for each evaluation", () => {
    const state = fixture(); state.run("lambda: missing"); state.run("lambda: missing");
    expect(state.created[0].defaults).not.toBe(state.created[1].defaults);
    expect(state.events).toEqual(["create", "create"]);
  });
  it("evaluates nested lambda defaults before creating the containing lambda", () => {
    const state = fixture(); state.names.set("seed", 7);
    state.run("lambda x=(lambda y=seed: missing): missing");
    expect(state.events).toEqual(["load:seed", "create", "create"]);
    expect(state.created[1].defaults.get("x")).toBe(state.created[0]);
  });
  it("retains default-expression side effects when a later default fails", () => {
    const state = fixture(); state.names.set("seed", 7);
    expect(() => state.run("lambda x=(saved := seed), y=missing: 1")).toThrow("missing:missing");
    expect(state.names.get("saved")).toBe(7); expect(state.created).toEqual([]);
  });
  it("does not reuse a default expression's truth state for the created function", () => {
    const state = fixture(); state.names.set("flag", false);
    expect(evaluateExpression(parseExpression("lambda x=(flag and missing): missing"), state.context, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), "branch")).toBe(true);
    expect(state.events).toEqual(["load:flag", "truth", "create", "truth"]);
  });
  it("fails before defaults when the lambda backend is unavailable", () => {
    const state = fixture(); delete state.context.createLambda;
    expect(() => state.run("lambda x=missing: missing")).toThrow(UnsupportedExpressionError);
    expect(state.events).toEqual([]);
  });
  it("checks entry limits before evaluating defaults", () => {
    const state = fixture(); expect(() => state.run("lambda x=missing: missing", 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
  it("propagates creation failures after defaults", () => {
    const state = fixture(), error = new Error("creation failed"); state.names.set("seed", 7);
    state.context.createLambda = () => { throw error; };
    expect(() => state.run("lambda x=seed: missing")).toThrow(error);
    expect(state.events).toEqual(["load:seed"]);
  });
  it("evaluates deeply nested lambda defaults without recursive host evaluation", () => {
    const state = fixture(); state.names.set("seed", 7);
    const template = parseExpression("lambda x=seed: missing");
    if (template.kind !== "lambda") throw new Error("expected lambda");
    let node: Expression = template;
    for (let index = 0; index < 4000; index++) node = { ...template, parameters: [{ ...template.parameters[0], default: node }] };
    evaluateExpression(node, state.context, new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }));
    expect(state.created).toHaveLength(4001);
  });
});
