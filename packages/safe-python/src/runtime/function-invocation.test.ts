import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import type { Expression } from "../ast.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { invokeFunction, UnsupportedFunctionExecutionError, type FunctionInvocationContext } from "./function-invocation.js";
import type { LexicalFrame } from "./lexical-frame.js";
import { CallStack } from "./call-stack.js";
import { PythonRuntimeError } from "./error.js";
import { compileFunction } from "./function-compilation.js";

function fixture(source: string) {
  const analysis = analyzeModule(source), scope = analysis.scopes.children[0];
  const node = scope.scope.node;
  if (node.kind !== "function" && node.kind !== "lambda") throw new Error("expected function");
  const code = compileFunction<unknown>(scope, analysis, { stripDocstring: false }, { string: value => value, integer: value => value }, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }));
  const events: unknown[] = [], frames: LexicalFrame<unknown>[] = [];
  const none = { none: true };
  const calls = new CallStack<LexicalFrame<unknown>>(10, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }));
  const context: FunctionInvocationContext<unknown> = {
    calls,
    globals: new Map(), builtins: new Map(),
    tuple: values => [...values], dictionary: values => new Map(values), none,
    body: frame => {
      events.push("body-context"); frames.push(frame);
      const evaluate = (expression: Expression): unknown => {
        if (expression.kind === "name") return frame.load(expression.name);
        if (expression.kind === "literal") return typeof expression.value === "bigint" ? Number(expression.value) : expression.value;
        throw new Error("unexpected expression");
      };
      return {
        evaluate, test: expression => Boolean(evaluate(expression)),
        iterate: value => (value as Iterable<unknown>)[Symbol.iterator](),
        assign: (target, value) => { if (target.kind !== "name") throw new Error("unexpected target"); frame.store(target.name, value); },
        execute: statement => {
          if (statement.kind === "expression-statement") events.push(evaluate(statement.expression));
          else throw new Error("unexpected statement");
        }
      };
    },
    suspended: (executionKind, frame) => { events.push("suspended"); return { kind: executionKind, frame }; }
  };
  const run = (positional: unknown[] = [], maxSteps = 10000) => invokeFunction(code, {
    name: node.kind === "function" ? node.name.name : "<lambda>", positional, keywords: new Map(), defaults: new Map()
  }, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 }));
  return { run, context, events, frames, none, calls, code };
}

describe("function invocation dispatch", () => {
  it("does not execute compiled docstrings as expression statements", () => {
    const state = fixture('def f():\n "documentation"\n return 7');
    expect(state.run()).toBe(7);
    expect(state.events).toEqual(["body-context"]);
  });

  it("passes reusable compiled bodies to the suspension backend without executing them", () => {
    const state = fixture('def f():\n "documentation"\n yield 7');
    state.context.suspended = (kind, frame, code) => {
      expect(kind).toBe("generator");
      expect(code).toBe(state.code);
      expect(frame.scope).toBe(code.scope);
      expect(code.body.kind === "suite" && code.body.statements.map(statement => statement.kind)).toEqual(["expression-statement"]);
      return { code, frame };
    };
    const first = state.run(), second = state.run();
    expect(first).not.toBe(second);
    expect(state.events).toEqual([]);
    expect(state.calls.depth).toBe(0);
  });

  it("runs a bound ordinary function and returns its original value", () => {
    const state = fixture("def f(a):\n 1\n return a\n 2");
    const value = {};
    expect(state.run([value])).toBe(value);
    expect(state.events).toEqual(["body-context", 1]);
  });

  it.each(["def f(): pass", "def f(): return"])("maps implicit or bare returns to guest None: %s", source => {
    const state = fixture(source);
    expect(state.run()).toBe(state.none);
  });

  it.each([null, undefined])("does not confuse an explicit %s return with bare return", value => {
    const state = fixture("def f(a): return a");
    expect(state.run([value])).toBe(value);
  });

  it("evaluates a lambda body as a value", () => {
    const state = fixture("f = lambda a: a");
    expect(state.run([undefined])).toBeUndefined();
    expect(state.events).toEqual(["body-context"]);
  });

  it("preserves finally overriding a return, including bare return", () => {
    const state = fixture("def f(a):\n try: return a\n finally:\n  7\n  return");
    expect(state.run([9])).toBe(state.none);
    expect(state.events).toEqual(["body-context", 7]);
  });

  it("keeps loop assignments in the current activation", () => {
    const state = fixture("def f(items):\n for item in items:\n  if item: return item\n return");
    expect(state.run([[0, 8, 9]])).toBe(8);
    expect(state.run([[0, 0]])).toBe(state.none);
    expect(state.frames[0]).not.toBe(state.frames[1]);
    expect(state.frames[0].load("item")).toBe(8);
    expect(state.frames[1].load("item")).toBe(0);
  });

  it.each([
    ["def f(a): yield a", "generator"],
    ["def f(a):\n if False: yield a", "generator"],
    ["async def f(a): return a", "coroutine"],
    ["async def f(a): yield a", "async-generator"],
    ["f = lambda a: (yield a)", "generator"]
  ])("creates but never executes a suspended activation: %s", (source, kind) => {
    const state = fixture(source);
    const result = state.run([4]) as { kind: string; frame: LexicalFrame<unknown> };
    expect(result.kind).toBe(kind);
    expect(result.frame.load("a")).toBe(4);
    expect(state.events).toEqual(["suspended"]);
    expect(state.frames).toEqual([]);
  });

  it.each(["def f(a): return a", "def f(a): yield a", "async def f(a): return a"])("rejects argument errors before body or suspension creation: %s", source => {
    const state = fixture(source);
    expect(() => state.run()).toThrow("f() missing 1 required positional argument: 'a'");
    expect(state.events).toEqual([]);
  });

  it("fails explicitly when a suspension backend is absent", () => {
    const state = fixture("def f(a): yield a");
    delete state.context.suspended;
    expect(() => state.run([1])).toThrow(UnsupportedFunctionExecutionError);
    expect(state.events).toEqual([]);
  });

  it("preserves body adapter failures without converting them to None", () => {
    const state = fixture("def f(): pass"), error = new Error("adapter failed");
    state.context.body = () => { throw error; };
    expect(() => state.run()).toThrow(error);
  });

  it("preserves suspension backend failures", () => {
    const state = fixture("async def f(): pass"), error = new Error("allocation failed");
    state.context.suspended = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.events).toEqual([]);
  });

  it("meters invocation before any body or suspension effects", () => {
    const state = fixture("def f(): pass");
    expect(() => state.run([], 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });

  it("tracks recursive body entry and cleans up after a recursion error", () => {
    const state = fixture("def f(a): return a");
    const originalBody = state.context.body;
    const depths: number[] = [];
    state.context.body = frame => {
      expect(state.calls.current).toBe(frame);
      depths.push(state.calls.depth);
      const body = originalBody(frame);
      body.evaluate = () => {
        const remaining = frame.load("a") as number;
        return remaining > 0 ? state.run([remaining - 1]) : remaining;
      };
      return body;
    };
    expect(state.run([3])).toBe(0);
    expect(depths).toEqual([1, 2, 3, 4]);
    expect(state.calls.depth).toBe(0);
    expect(() => state.run([20])).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(state.calls.depth).toBe(0);
    expect(state.calls.current).toBeUndefined();
    expect(state.run([1])).toBe(0);
  });

  it("restores call state after body-context failures and fatal body limits", () => {
    const state = fixture("def f(): pass");
    state.context.body = () => { throw new ExecutionLimitError("steps"); };
    expect(() => state.run()).toThrow(ExecutionLimitError);
    expect(state.calls.depth).toBe(0);
  });

  it("allows a guest handler to recover from excess depth inside an active caller", () => {
    const state = fixture("def f(a):\n try: return a\n except: return 99");
    const originalBody = state.context.body;
    state.context.body = frame => {
      const body = originalBody(frame), evaluate = body.evaluate;
      body.evaluate = expression => {
        if (expression.kind === "name") {
          const remaining = frame.load("a") as number;
          return remaining > 0 ? state.run([remaining - 1]) : remaining;
        }
        expect(state.calls.current).toBe(frame);
        expect(state.calls.depth).toBe(10);
        return evaluate(expression);
      };
      body.exceptions = {
        isGuest: error => error instanceof PythonRuntimeError,
        enter: () => () => {},
        handlers: { match: () => true, bind: () => {}, clear: () => {} }
      };
      return body;
    };
    expect(state.run([20])).toBe(99);
    expect(state.calls.depth).toBe(0);
    expect(state.run([2])).toBe(0);
    expect(state.calls.depth).toBe(0);
  });

  it("does not enter a body frame for unstarted suspended calls", () => {
    const state = fixture("async def f(): pass");
    const original = state.context.suspended!;
    state.context.suspended = (kind, frame) => {
      expect(state.calls.depth).toBe(0);
      return original(kind, frame);
    };
    state.run();
    expect(state.calls.depth).toBe(0);
  });
});
