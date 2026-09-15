import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Expression } from "../ast.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import { ExecutionBudget } from "./execution-budget.js";

class Guest extends Error { context?: Guest; }
function fixture(maxSteps = 100000) {
  const events: string[] = [], names = new Map<string, unknown>(), suppress = new Set<string>();
  let active: Guest | undefined, failure = "";
  const fail = (message: string): never => { const error = new Guest(message); error.context = active; throw error; };
  const step = (name: string) => { events.push(name); if (name === failure) fail(name); };
  const evaluate = (node: Expression): unknown => {
    if (node.kind === "literal") return typeof node.value === "bigint" ? Number(node.value) : node.value;
    if (node.kind !== "name") throw new Error("unsupported fixture expression");
    step(`eval:${node.name}`);
    if (node.name === "boom") fail("boom");
    return names.has(node.name) ? names.get(node.name) : node.name;
  };
  const context: StatementContext<unknown> = {
    evaluate, test: node => Boolean(evaluate(node)), iterate: () => [1, 2][Symbol.iterator](),
    assign: (target, value) => { if (target.kind !== "name") throw new Error("unsupported target"); step(`assign:${target.name}`); names.set(target.name, value); },
    execute: statement => { if (statement.kind !== "expression-statement") throw new Error("unsupported statement"); evaluate(statement.expression); },
    exceptions: { isGuest: error => error instanceof Guest, enter: error => { const previous = active; active = error as Guest; return () => { active = previous; }; } },
    managers: {
      prepare: value => {
        const name = String(value); step(`prepare:${name}`);
        return {
          enter: () => { step(`enter:${name}`); return `${name}-value`; },
          exit: exception => { step(`exit:${name}:${(exception?.error as Guest | undefined)?.message ?? "none"}:${active?.message ?? "none"}`); if (failure === `exit:${name}`) fail(`exit:${name}`); return name; }
        };
      },
      truth: value => { step(`truth:${value}`); return suppress.has(String(value)); }
    }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
  return { context, events, names, suppress, meter, active: () => active, failure: (stage: string) => { failure = stage; }, run: (source: string) => executeStatements(parseModule(source).body, context, meter) };
}

describe("synchronous context managers", () => {
  it("prepares native exit failures before restoring the body exception",()=>{
    const state=fixture();
    state.context.exceptions!.prepare=error=>{
      if(error instanceof Guest)return error;
      const prepared=new Guest("native exit");prepared.context=state.active();return prepared;
    };
    state.context.managers!.prepare=()=>({enter:()=>undefined,exit(){throw Error("native");}});
    let failure:Guest|undefined;
    try{state.run("with a:\n boom");}catch(error){failure=error as Guest;}
    expect(failure?.message).toBe("native exit");expect(failure?.context?.message).toBe("boom");
    expect(state.active()).toBeUndefined();
  });
  it("retains the prepared exit callback even if enter changes the adapter object", () => {
    const state = fixture();
    const manager = {
      enter: () => { manager.exit = () => { throw new Error("replacement exit"); }; return undefined; },
      exit: () => { state.events.push("original exit"); return undefined; }
    };
    state.context.managers!.prepare = () => manager;
    state.run("with a as x:\n  pass");
    expect(state.names.has("x")).toBe(true);
    expect(state.names.get("x")).toBeUndefined();
    expect(state.events).toEqual(["eval:a", "assign:x", "original exit"]);
  });

  it("enters managers left to right and exits in reverse order", () => {
    const state = fixture();
    state.run("with a as x, b as y:\n  body\nafter");
    expect(state.events).toEqual(["eval:a", "prepare:a", "enter:a", "assign:x", "eval:b", "prepare:b", "enter:b", "assign:y", "eval:body", "exit:b:none:none", "exit:a:none:none", "eval:after"]);
    expect([...state.names]).toEqual([["x", "a-value"], ["y", "b-value"]]);
  });

  it.each(["eval:b", "prepare:b", "enter:b"])("unwinds only successfully entered managers after %s fails", stage => {
    const state = fixture(); state.failure(stage);
    expect(() => state.run("with a, b:\n  body")).toThrow(stage);
    expect(state.events).toContain(`exit:a:${stage}:${stage}`);
    expect(state.events.some(event => event.startsWith("exit:b"))).toBe(false);
    expect(state.events).not.toContain("eval:body");
    expect(state.active()).toBeUndefined();
  });

  it("registers exit before assignment and permits suppressing assignment failure", () => {
    const state = fixture(); state.failure("assign:x"); state.suppress.add("a");
    state.run("with a as x, b:\n  body\nafter");
    expect(state.events).toEqual(["eval:a", "prepare:a", "enter:a", "assign:x", "exit:a:assign:x:assign:x", "truth:a", "eval:after"]);
    expect(state.names.has("x")).toBe(false);
  });

  it("makes a suppressed inner exception a normal outer exit", () => {
    const state = fixture(); state.suppress.add("b");
    state.run("with a, b:\n  boom\nafter");
    expect(state.events.slice(-4)).toEqual(["exit:b:boom:boom", "truth:b", "exit:a:none:none", "eval:after"]);
    expect(state.active()).toBeUndefined();
  });

  it.each(["return 7", "break", "continue"])("ignores exit truth on %s", action => {
    const state = fixture(); state.failure("truth:a");
    const result = state.run(`for x in items:\n  with a:\n    ${action}\nelse:\n  after`);
    if (action === "return 7") expect(result).toEqual({ kind: "return", value: 7 });
    expect(state.events.filter(event => event.startsWith("exit:"))).toEqual(Array(action === "continue" ? 2 : 1).fill("exit:a:none:none"));
    expect(state.events).not.toContain("truth:a");
  });

  it("chains an exit failure and passes it to the next outer manager", () => {
    const state = fixture(); state.failure("exit:b"); state.suppress.add("a");
    state.run("with a, b:\n  boom\nafter");
    expect(state.events.slice(-4)).toEqual(["exit:b:boom:boom", "exit:a:exit:b:exit:b", "truth:a", "eval:after"]);
    expect(state.active()).toBeUndefined();
  });

  it("treats exit-result truth failures as exceptions for outer managers", () => {
    const state = fixture(); state.failure("truth:b"); state.suppress.add("a");
    state.run("with a, b:\n  boom");
    expect(state.events.slice(-3)).toEqual(["truth:b", "exit:a:truth:b:truth:b", "truth:a"]);
    expect(state.active()).toBeUndefined();
  });

  it("does not run guest exits on execution-limit failure", () => {
    const state = fixture(25);
    expect(() => state.run("with a:\n  while True:\n    pass")).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["eval:a", "prepare:a", "enter:a"]);
    expect(state.active()).toBeUndefined();
  });

  it("does not recurse while entering and leaving many managers", () => {
    const node = parseModule("with a:\n  return 1").body[0];
    if (node.kind !== "with") throw new Error("invalid fixture");
    const state = fixture();
    expect(executeStatements([{ ...node, items: Array(5000).fill(node.items[0]) }], state.context, state.meter)).toEqual({ kind: "return", value: 1 });
    expect(state.events.filter(event => event.startsWith("exit:"))).toHaveLength(5000);
  });

  it("rejects async with before evaluating the manager", () => {
    const state = fixture();
    expect(() => state.run("async with a:\n  body")).toThrow("unsupported statement");
    expect(state.events).toEqual([]);
  });
});
