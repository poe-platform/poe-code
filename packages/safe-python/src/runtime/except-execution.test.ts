import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Expression } from "../ast.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import { ExecutionBudget } from "./execution-budget.js";

class Guest extends Error { context?: Guest; }
function fixture(maxSteps = 10000) {
  const events: unknown[] = [], names = new Map<string, unknown>([["items", [1, 2]]]);
  const first = new Guest("first"), second = new Guest("second");
  let active: Guest | undefined;
  const evaluate = (node: Expression): unknown => {
    if (node.kind === "literal") return typeof node.value === "bigint" ? Number(node.value) : node.value;
    if (node.kind !== "name") throw new Error("unsupported fixture");
    if (["A", "B", "bad"].includes(node.name)) events.push(`type:${node.name}:${active?.message}`);
    if (node.name === "A" || node.name === "B") return node.name;
    if (["first", "second", "bad"].includes(node.name)) {
      const error = node.name === "first" ? first : second;
      if (error !== active) error.context = active;
      throw error;
    }
    if (node.name === "active") return active?.message;
    return names.get(node.name);
  };
  const context: StatementContext<unknown> = {
    evaluate, test: node => Boolean(evaluate(node)),
    iterate: value => (value as Iterable<unknown>)[Symbol.iterator](),
    assign: (target, value) => { if (target.kind !== "name") throw new Error("invalid target"); names.set(target.name, value); },
    execute: node => {
      if (node.kind === "raise" && node.exception === null) { if (!active) throw new Error("no active exception"); throw active; }
      if (node.kind !== "expression-statement") throw new Error("unsupported fixture statement");
      const value = evaluate(node.expression); events.push(value instanceof Guest ? value.message : value);
    },
    exceptions: {
      isGuest: error => error instanceof Guest,
      enter: error => { const previous = active; active = error as Guest; return () => { active = previous; }; },
      handlers: {
        match: (error, type) => (error as Guest).message === (type === "A" ? "first" : "second"),
        bind: (name, error) => { events.push(`bind:${name}`); names.set(name, error); },
        clear: name => { events.push(`clear:${name}`); names.delete(name); }
      }
    }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
  return { context, events, names, first, second, active: () => active, run: (source: string) => executeStatements(parseModule(source).body, context, meter) };
}

describe("ordinary exception handlers", () => {
  it.each(["raise", "second", "return second"])("retains the caught exception during alias cleanup after %s", action => {
    const state = fixture(), seen: unknown[] = [];
    state.context.exceptions!.handlers!.clear = () => { seen.push(state.active()); };
    expect(() => state.run(`try:\n  first\nexcept A as err:\n  ${action}`)).toThrow(action === "raise" ? state.first : state.second);
    expect(seen).toEqual([state.first]);
    expect(state.active()).toBeUndefined();
  });

  it("does not clear an alias whose binding failed", () => {
    const state = fixture();
    state.context.exceptions!.handlers!.bind = () => { throw state.second; };
    expect(() => state.run("try:\n  first\nexcept A as err:\n  99\nfinally:\n  active")).toThrow(state.second);
    expect(state.events).toEqual(["type:A:first", "second"]);
    expect(state.active()).toBeUndefined();
  });

  it.each(["pass", "return 1", "break", "continue"])("restores active state before alias cleanup after %s", action => {
    const state = fixture(), seen: unknown[] = [];
    state.context.exceptions!.handlers!.clear = () => { seen.push(state.active()); };
    state.run(`for x in items:\n  try:\n    first\n  except A as err:\n    ${action}`);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(value => value === undefined)).toBe(true);
  });

  it("matches headers in order with the exception active and binds only the selected alias", () => {
    const state = fixture();
    state.run("try:\n  first\nexcept B:\n  0\nexcept A as err:\n  err\nexcept bad:\n  99\nelse:\n  98\nfinally:\n  2\n3");
    expect(state.events).toEqual(["type:B:first", "type:A:first", "bind:err", "first", "clear:err", 2, 3]);
    expect(state.names.has("err")).toBe(false);
    expect(state.active()).toBeUndefined();
  });

  it("skips matching on normal completion and runs else before finally", () => {
    const state = fixture();
    state.run("try:\n  1\nexcept bad:\n  99\nelse:\n  2\nfinally:\n  3");
    expect(state.events).toEqual([1, 2, 3]);
  });

  it("does not handle an exception raised in its else clause", () => {
    const state = fixture();
    expect(() => state.run("try:\n  1\nexcept A:\n  99\nelse:\n  first\nfinally:\n  2")).toThrow(state.first);
    expect(state.events).toEqual([1, 2]);
  });

  it("does not test later handlers when header evaluation fails", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nexcept bad:\n  1\nexcept:\n  99\nfinally:\n  2")).toThrow(state.second);
    expect(state.second.context).toBe(state.first);
    expect(state.events).toEqual(["type:bad:first", 2]);
    expect(state.active()).toBeUndefined();
  });

  it("reraises the original unmatched exception after restoring handler-search state", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nexcept B:\n  99")).toThrow(state.first);
    expect(state.active()).toBeUndefined();
  });

  it("runs a bare handler without evaluating or matching a type", () => {
    const state = fixture();
    state.context.exceptions!.handlers!.match = () => { throw new Error("must not match"); };
    state.run("try:\n  first\nexcept:\n  active");
    expect(state.events).toEqual(["first"]);
    expect(state.active()).toBeUndefined();
  });

  it.each(["return err", "raise"])("clears aliases and restores active state on %s", transfer => {
    const state = fixture(); state.names.set("err", "previous");
    const source = `try:\n  first\nexcept A as err:\n  ${transfer}\nfinally:\n  2`;
    if (transfer === "raise") expect(() => state.run(source)).toThrow(state.first);
    else expect(state.run(source)).toEqual({ kind: "return", value: state.first });
    expect(state.events).toEqual(["type:A:first", "bind:err", "clear:err", 2]);
    expect(state.names.has("err")).toBe(false);
    expect(state.active()).toBeUndefined();
  });

  it.each(["break", "continue"])("clears aliases before a handler's %s", transfer => {
    const state = fixture();
    state.run(`for x in items:\n  try:\n    first\n  except A as err:\n    ${transfer}\nelse:\n  3`);
    const iteration = ["type:A:first", "bind:err", "clear:err"];
    expect(state.events).toEqual(transfer === "break" ? iteration : [...iteration, ...iteration, 3]);
  });

  it("restores the outer active exception after an inner handler", () => {
    const state = fixture();
    state.run("try:\n  first\nexcept:\n  active\n  try:\n    second\n  except:\n    active\n  active");
    expect(state.events).toEqual(["first", "second", "first"]);
    expect(state.second.context).toBe(state.first);
    expect(state.active()).toBeUndefined();
  });

  it("allows outer handlers to catch failures from alias cleanup", () => {
    const state = fixture();
    state.context.exceptions!.handlers!.clear = () => { throw state.second; };
    state.run("try:\n  try:\n    first\n  except A as err:\n    return 9\nexcept B:\n  2");
    expect(state.events).toEqual(["type:A:first", "bind:err", "type:B:second", 2]);
    expect(state.active()).toBeUndefined();
  });

  it("restores exception bookkeeping without guest alias cleanup after fatal termination", () => {
    const state = fixture(30);
    expect(() => state.run("try:\n  first\nexcept A as err:\n  while True:\n    pass")).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["type:A:first", "bind:err"]);
    expect(state.active()).toBeUndefined();
  });

  it("rejects exception groups before executing the body", () => {
    const state = fixture();
    expect(() => state.run("try:\n  1\nexcept* A:\n  2")).toThrow("unsupported statement");
    expect(state.events).toEqual([]);
  });
});
