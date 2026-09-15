import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import { ExecutionBudget } from "./execution-budget.js";

class GuestError extends Error { context?: GuestError; }

function fixture(maxSteps = 100000) {
  const events: unknown[] = [], names = new Map<string, unknown>([["items", [1, 2]]]);
  const first = new GuestError("first"), second = new GuestError("second");
  let active: GuestError | undefined;
  const evaluate = (node: Expression): unknown => {
    if (node.kind === "literal") return typeof node.value === "bigint" ? Number(node.value) : node.value;
    if (node.kind !== "name") throw new Error("unsupported fixture expression");
    if (node.name === "first" || node.name === "second") {
      const error = node.name === "first" ? first : second;
      if (active !== error) error.context = active;
      throw error;
    }
    if (node.name === "host") throw new Error("host failure");
    return names.get(node.name);
  };
  const context: StatementContext<unknown> = {
    evaluate, test: node => Boolean(evaluate(node)),
    iterate: value => (value as Iterable<unknown>)[Symbol.iterator](),
    assign: (target, value) => { if (target.kind !== "name") throw new Error("invalid target"); names.set(target.name, value); },
    execute: node => {
      if (node.kind === "raise" && node.exception === null) { if (!active) throw new Error("no active exception"); throw active; }
      if (node.kind !== "expression-statement") throw new Error("unsupported fixture statement");
      events.push(evaluate(node.expression));
    },
    exceptions: {
      isGuest: error => error instanceof GuestError,
      enter: error => { const previous = active; active = error as GuestError; return () => { active = previous; }; }
    }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
  return { context, events, first, second, active: () => active, run: (source: string) => executeStatements(parseModule(source).body, context, meter), meter };
}

describe("finally execution", () => {
  it("runs cleanup after normal completion and continues the enclosing block", () => {
    const state = fixture();
    expect(state.run("try:\n  1\nfinally:\n  2\n3")).toEqual({ kind: "normal" });
    expect(state.events).toEqual([1, 2, 3]);
  });

  it("evaluates return values before cleanup and permits return replacement", () => {
    const state = fixture();
    expect(state.run("try:\n  return 1\nfinally:\n  2")).toEqual({ kind: "return", value: 1 });
    expect(state.run("try:\n  return 1\nfinally:\n  return 3")).toEqual({ kind: "return", value: 3 });
    expect(state.events).toEqual([2]);
  });

  it.each(["break", "continue"])("runs cleanup before resuming %s", transfer => {
    const state = fixture();
    state.run(`for x in items:\n  try:\n    x\n    ${transfer}\n  finally:\n    9\nelse:\n  8\n7`);
    expect(state.events).toEqual(transfer === "break" ? [1, 9, 7] : [1, 9, 2, 9, 8, 7]);
  });

  it("lets finally continue replace a pending break", () => {
    const state = fixture();
    state.run("for x in items:\n  try:\n    break\n  finally:\n    x\n    continue\nelse:\n  3");
    expect(state.events).toEqual([1, 2, 3]);
  });

  it("propagates the same guest exception after cleanup", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nfinally:\n  2\n3")).toThrow(state.first);
    expect(state.events).toEqual([2]);
    expect(state.active()).toBeUndefined();
  });

  it("makes the pending exception available to bare raise during cleanup", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nfinally:\n  raise")).toThrow(state.first);
    expect(state.active()).toBeUndefined();
  });

  it("provides exception context for a replacement failure in finally", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nfinally:\n  second")).toThrow(state.second);
    expect(state.second.context).toBe(state.first);
    expect(state.active()).toBeUndefined();
  });

  it("allows finally return to suppress a guest exception", () => {
    const state = fixture();
    expect(state.run("try:\n  first\nfinally:\n  return 8")).toEqual({ kind: "return", value: 8 });
    expect(state.active()).toBeUndefined();
  });

  it("restores nested active exceptions and runs outer cleanup last", () => {
    const state = fixture();
    expect(() => state.run("try:\n  first\nfinally:\n  try:\n    try:\n      second\n    finally:\n      return 9\n  finally:\n    raise")).toThrow(state.first);
    expect(state.active()).toBeUndefined();
  });

  it("does not suppress host failures or run guest cleanup after fatal termination", () => {
    const state = fixture(25);
    expect(() => state.run("try:\n  host\nfinally:\n  1\n  return 9")).toThrow("host failure");
    expect(state.events).toEqual([]);
    state.context.exceptions!.isGuest = () => true;
    expect(() => state.run("try:\n  while True:\n    pass\nfinally:\n  1\n  return 9")).toThrow("execution step limit exceeded");
    expect(state.events).toEqual([]);
  });

  it("restores active exception state even when a finalizer exceeds its budget", () => {
    const state = fixture(30);
    expect(() => state.run("try:\n  first\nfinally:\n  while True:\n    pass")).toThrow("execution step limit exceeded");
    expect(state.active()).toBeUndefined();
  });

  it("handles deeply nested finalizers without host recursion", () => {
    const template = parseModule("try:\n  pass\nfinally:\n  1").body[0];
    if (template.kind !== "try") throw new Error("invalid fixture");
    let body: readonly Statement[] = parseModule("return 2").body;
    for (let i = 0; i < 5000; i++) body = [{ ...template, body }];
    const state = fixture();
    expect(executeStatements(body, state.context, state.meter)).toEqual({ kind: "return", value: 2 });
    expect(state.events).toHaveLength(5000);
  });
});
