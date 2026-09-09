import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { executeClassDefinition, type ClassDefinitionContext } from "./class-definition.js";

function fixture(failure?: string) {
  const events: string[] = [], positional: unknown[] = [], keywords = new Map<string, unknown>();
  const old = {}, built = {}, builder = {}, names = new Map<string, unknown>([["C", old]]);
  const error = new Error("failure");
  function step(event: string) { events.push(event); if (failure === event) throw error; }
  const context: ClassDefinitionContext<unknown> = {
    evaluate: expression => { if (expression.kind !== "name") throw new Error("unexpected expression"); step(`eval:${expression.name}`); return expression.name; },
    lookupBuilder: () => { step("builder"); return builder; },
    createBody: statement => { step("body"); return { statement }; },
    nameValue: name => { step("name"); return name; },
    beginCall: value => {
      expect(value).toBe(builder);
      return {
        positional: value => { positional.push(value); },
        starred: value => { step("star"); positional.push(value); },
        keywords: entries => { step("keywords"); for (const [key, value] of entries) keywords.set(key, value); },
        mapping: value => { step("mapping"); keywords.set("extra", value); },
        invoke: () => { step("build"); expect(names.get("C")).toBe(old); return built; }
      };
    },
    decorate: (decorator, value) => { step(`apply:${decorator}`); expect(names.get("C")).toBe(old); return { decorator, value }; },
    store: (name, value) => { step("store"); names.set(name, value); }
  };
  const run = (source = "@outer\n@inner\nclass C(base, *bases, flag=keyword, **mapping):\n body", maxSteps = 10000) => {
    const statement = parseModule(source).body[0];
    if (statement.kind !== "class") throw new Error("expected class");
    executeClassDefinition(statement, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 }));
    return statement;
  };
  return { context, events, positional, keywords, names, old, built, error, run };
}

describe("class definition execution", () => {
  it("evaluates decorators, invokes the builtin builder, decorates and binds last", () => {
    const state = fixture(), statement = state.run();
    expect(state.events).toEqual(["eval:outer", "eval:inner", "builder", "body", "name", "eval:base", "eval:bases", "star", "eval:keyword", "keywords", "eval:mapping", "mapping", "build", "apply:inner", "apply:outer", "store"]);
    expect(state.positional).toEqual([{ statement }, "C", "base", "bases"]);
    expect((state.positional[0] as { statement: unknown }).statement).toBe(statement);
    expect([...state.keywords]).toEqual([["flag", "keyword"], ["extra", "mapping"]]);
    expect(state.names.get("C")).toEqual({ decorator: "outer", value: { decorator: "inner", value: state.built } });
  });

  it.each(["eval:outer", "eval:inner", "builder", "body", "name", "eval:base", "star", "keywords", "mapping", "build", "apply:inner", "apply:outer", "store"])("stops at %s without rebinding", failure => {
    const state = fixture(failure);
    expect(() => state.run()).toThrow(state.error);
    expect(state.events.at(-1)).toBe(failure);
    expect(state.names.get("C")).toBe(state.old);
  });

  it("expands a sole starred base before keyword values", () => {
    const state = fixture();
    state.run("class C(flag=keyword, *bases): pass");
    expect(state.events).toEqual(["builder", "body", "name", "eval:bases", "star", "eval:keyword", "keywords", "build", "store"]);
  });

  it("does not execute the body or ignored type bounds outside the builder", () => {
    const state = fixture();
    state.run("class C[T: ignored](base):\n body");
    expect(state.events).toEqual(["builder", "body", "name", "eval:base", "build", "store"]);
  });

  it("defers builder callability checks until after header evaluation", () => {
    const state = fixture();
    state.context.lookupBuilder = () => undefined;
    state.context.beginCall = value => {
      expect(value).toBeUndefined();
      return { positional: () => {}, starred: () => {}, keywords: () => {}, mapping: () => {}, invoke: () => { throw new TypeError("not callable"); } };
    };
    expect(() => state.run("class C(base): pass")).toThrow("not callable");
    expect(state.events).toEqual(["body", "name", "eval:base"]);
  });

  it("binds arbitrary decorator results, including undefined", () => {
    const state = fixture();
    state.context.decorate = () => undefined;
    state.run("@outer\nclass C: pass");
    expect(state.names.has("C")).toBe(true);
    expect(state.names.get("C")).toBeUndefined();
  });

  it("uses normalized names for the builder argument and final store", () => {
    const state = fixture();
    state.run("class K: pass");
    expect(state.positional[1]).toBe("K");
    expect(state.names.get("K")).toBe(state.built);
  });

  it("stops before decorator evaluation when the budget is exhausted", () => {
    const state = fixture();
    expect(() => state.run(undefined, 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
});
