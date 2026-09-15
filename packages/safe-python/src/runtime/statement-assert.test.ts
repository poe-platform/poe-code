import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { executeStatements, UnsupportedStatementError, type StatementContext } from "./statement-execution.js";

class AssertionFault extends Error {
  constructor(readonly args: unknown[]) { super("assertion"); }
}

function fixture(condition = false, message: unknown = "message", enabled = true) {
  const events: string[] = [];
  const context: StatementContext<unknown> = {
    evaluate: () => { events.push("message"); return message; },
    test: () => { events.push("test"); return condition; },
    iterate: () => { throw new Error("unexpected iteration"); },
    assign: () => { throw new Error("unexpected assignment"); },
    execute: () => { events.push("leaf"); },
    assertions: {
      enabled,
      fail: argument => {
        events.push("fail");
        throw new AssertionFault(argument === null ? [] : [argument.value]);
      }
    },
    exceptions: {
      isGuest: error => error instanceof AssertionFault,
      enter: () => { events.push("enter"); return () => { events.push("restore"); }; }
    }
  };
  const run = (source = "assert condition, message", maxSteps = 1000) => executeStatements(
    parseModule(source).body, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 })
  );
  return { context, events, run };
}

describe("assert statement execution", () => {
  it("requires a capability before evaluating operands", () => {
    const state = fixture();
    delete state.context.assertions;
    expect(() => state.run()).toThrow(UnsupportedStatementError);
    expect(state.events).toEqual([]);
  });

  it.each([true, false])("skips both operands when disabled (condition %s)", condition => {
    const state = fixture(condition, "unused", false);
    expect(state.run()).toEqual({ kind: "normal" });
    expect(state.events).toEqual([]);
  });

  it("tests in branching context and skips a successful assertion's message", () => {
    const state = fixture(true);
    expect(state.run()).toEqual({ kind: "normal" });
    expect(state.events).toEqual(["test"]);
  });

  it("raises without arguments when no message is supplied", () => {
    const state = fixture();
    expect(() => state.run("assert condition")).toThrow(new AssertionFault([]));
    try { state.run("assert condition"); } catch (error) { expect((error as AssertionFault).args).toEqual([]); }
    expect(state.events).toEqual(["test", "fail", "test", "fail"]);
  });

  it.each([null, undefined, [1, 2], { opaque: true }])("preserves one message argument: %s", message => {
    const state = fixture(false);
    state.context.evaluate = () => { state.events.push("message"); return message; };
    let caught: unknown;
    try { state.run(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AssertionFault);
    expect((caught as AssertionFault).args).toHaveLength(1);
    expect((caught as AssertionFault).args[0]).toBe(message);
    expect(state.events).toEqual(["test", "message", "fail"]);
  });

  it.each(["test", "evaluate"] as const)("propagates %s failure without constructing an assertion", stage => {
    const state = fixture();
    const failure = new Error(stage);
    state.context[stage] = () => { throw failure; };
    expect(() => state.run()).toThrow(failure);
    expect(state.events).toEqual(stage === "test" ? [] : ["test"]);
  });

  it("unwinds guest assertion failures through finally", () => {
    const state = fixture();
    expect(() => state.run("try:\n  assert condition, message\nfinally:\n  cleanup")).toThrow(AssertionFault);
    expect(state.events).toEqual(["test", "message", "fail", "enter", "leaf", "restore"]);
  });

  it.each(["assert condition", "assert condition, message"])("meters failure work: %s", source => {
    const state = fixture();
    expect(() => state.run(source, 2)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual(["test"]);
  });
});
