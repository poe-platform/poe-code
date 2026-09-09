import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Statement } from "../statement-ast.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { executeFunctionDefinition, type FunctionDefinitionContext } from "./function-definition.js";

function definition(source: string) {
  const statement = parseModule(source).body[0];
  if (statement.kind !== "function") throw new Error("expected function definition");
  return statement;
}

function fixture(failure?: string) {
  const events: string[] = [];
  const old = {}, created = {};
  const names = new Map<string, unknown>([["f", old]]);
  const defaults: ReadonlyMap<string, unknown>[] = [];
  const statements: Extract<Statement, { kind: "function" }>[] = [];
  const fault = new Error("failed");
  function step(event: string) {
    events.push(event);
    if (event === failure) throw fault;
  }
  const context: FunctionDefinitionContext<unknown> = {
    evaluate: expression => {
      if (expression.kind !== "name") throw new Error("unexpected expression");
      step(expression.name);
      return expression.name;
    },
    create: (statement, values) => {
      step("create");
      defaults.push(values);
      statements.push(statement);
      return created;
    },
    decorate: (decorator, value) => {
      step(`apply:${decorator}`);
      expect(names.get("f")).toBe(old);
      return { decorator, value };
    },
    store: (name, value) => { step("store"); names.set(name, value); }
  };
  const run = (statement = definition("@outer\n@inner\ndef f(a=first, /, b=second, *, c=third):\n  body"), maxSteps = 1000) =>
    executeFunctionDefinition(statement, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 }));
  return { context, events, names, old, created, defaults, statements, fault, run };
}

describe("function definition execution", () => {
  it("evaluates decorators then defaults, applies inside-out and binds only the final value", () => {
    const state = fixture();
    state.run();
    expect(state.events).toEqual(["outer", "inner", "first", "second", "third", "create", "apply:inner", "apply:outer", "store"]);
    expect([...state.defaults[0]]).toEqual([["a", "first"], ["b", "second"], ["c", "third"]]);
    expect(state.names.get("f")).toEqual({ decorator: "outer", value: { decorator: "inner", value: state.created } });
  });

  it.each(["outer", "inner", "first", "second", "third", "create", "apply:inner", "apply:outer", "store"])("stops at %s without rebinding", failure => {
    const state = fixture(failure);
    expect(() => state.run()).toThrow(state.fault);
    const order = ["outer", "inner", "first", "second", "third", "create", "apply:inner", "apply:outer", "store"];
    expect(state.events).toEqual(order.slice(0, order.indexOf(failure) + 1));
    expect(state.names.get("f")).toBe(state.old);
  });

  it("does not evaluate parameter or return annotations, type bounds or the body", () => {
    const state = fixture();
    state.run(definition("def f[T: ignored](a: ignored = first, *args: ignored, c: ignored = second, **kw: ignored) -> ignored:\n  body"));
    expect(state.events).toEqual(["first", "second", "create", "store"]);
    expect([...state.defaults[0]]).toEqual([["a", "first"], ["c", "second"]]);
  });

  it.each(["def", "async def"])("passes the unchanged %s tree to the frame/object adapter", prefix => {
    const state = fixture();
    const statement = definition(`${prefix} f(a, /, *args, c, **kw):\n  body`);
    state.run(statement);
    expect(state.statements).toEqual([statement]);
    expect(state.statements[0]).toBe(statement);
    expect(state.defaults[0].size).toBe(0);
    expect(state.events).toEqual(["create", "store"]);
  });

  it("retains default value identity, including undefined, in a fresh map per definition", () => {
    const state = fixture();
    const shared: unknown[] = [];
    state.context.evaluate = expression => expression.kind === "name" && expression.name === "first" ? shared : undefined;
    const statement = definition("def f(a=first, *, b=second): pass");
    state.run(statement);
    state.run(statement);
    expect(state.defaults[0]).not.toBe(state.defaults[1]);
    for (const defaults of state.defaults) {
      expect(defaults.get("a")).toBe(shared);
      expect(defaults.has("b")).toBe(true);
      expect(defaults.get("b")).toBeUndefined();
    }
  });

  it("binds arbitrary decorator results without requiring them to be functions", () => {
    const state = fixture();
    state.context.decorate = () => undefined;
    state.run();
    expect(state.names.has("f")).toBe(true);
    expect(state.names.get("f")).toBeUndefined();
  });

  it("uses normalized binding names", () => {
    const state = fixture();
    state.run(definition("def K(): pass"));
    expect(state.names.get("K")).toBe(state.created);
    expect(state.names.has("K")).toBe(false);
  });

  it("checks budgets before each guest effect and never stores a partially decorated function", () => {
    const order = ["outer", "inner", "first", "second", "third", "create", "apply:inner", "apply:outer", "store"];
    for (let steps = 0; steps < 10; steps++) {
      const state = fixture();
      expect(() => state.run(undefined, steps)).toThrow(ExecutionLimitError);
      expect(state.events).toEqual(order.slice(0, Math.max(0, steps - 1)));
      expect(state.names.get("f")).toBe(state.old);
    }
  });
});
