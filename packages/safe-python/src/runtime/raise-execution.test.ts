import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { createRaiseContinuation, executeRaise, type RaiseContext } from "./raise-execution.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture(maxSteps = 1000) {
  const C = {}, D = {}, intType = {}, value = {}, cause = {}, signal = new Error("propagated");
  const events: string[] = [], inputs = new Map<string, unknown>([["e", C], ["c", D]]), constructors = new Map<unknown, unknown>([[C, value], [D, cause]]);
  const types = new Map<unknown, unknown>([[value, C], [cause, D]]), representations = new Map<unknown, string>([[C, "C"], [D, "D"], [intType, "int"]]);
  let active: { value: unknown } | undefined, propagated: unknown, assignedCause: unknown = "unchanged";
  const context: RaiseContext<unknown> = {
    evaluate: node => { if (node.kind === "literal" && node.literalKind === "none") return null; if (node.kind !== "name") throw new Error("fixture"); events.push(`eval:${node.name}`); return inputs.get(node.name); },
    isClass: candidate => constructors.has(candidate), isInstance: candidate => types.has(candidate), isNone: candidate => candidate === null,
    call: cls => { events.push(`call:${representations.get(cls)}`); return constructors.get(cls); },
    typeOf: candidate => types.get(candidate) ?? intType,
    repr: candidate => { events.push(`repr:${representations.get(candidate)}`); return representations.get(candidate)!; },
    setCause: (exception, explicitCause) => { expect(exception).toBe(value); events.push("setCause"); assignedCause = explicitCause === null ? null : explicitCause.value; },
    active: () => active,
    raise: (type, exception) => { events.push("raise"); propagated = { type, exception }; throw signal; },
    reraise: exception => { events.push("reraise"); propagated = exception; throw signal; }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 });
  return { C, D, value, cause, signal, events, inputs, constructors, types, context,
    active: (exception: unknown) => { active = { value: exception }; }, output: () => propagated, assignedCause: () => assignedCause,
    run: (source: string) => { const statement = parseModule(source).body[0]; if (statement.kind !== "raise") throw new Error("fixture"); return executeRaise(statement, context, meter); },
    continuation(source: string) {
      const statement = parseModule(source).body[0]; if (statement.kind !== "raise") throw Error("expected raise");
      return createRaiseContinuation(statement, { ...context,
        *evaluate(expression) {
          if (expression.kind === "yield" && expression.value !== null) return yield context.evaluate(expression.value);
          return context.evaluate(expression);
        }
      }, meter);
    }
  };
}

describe("raise execution", () => {
  it("distinguishes a constructed null host payload from explicit None", () => {
    const state = fixture(); state.constructors.set(state.D, null); state.types.set(null, state.D);
    let seen: unknown;
    state.context.setCause = (_exception, cause) => { seen = cause; };
    expect(() => state.run("raise e from c")).toThrow(state.signal);
    expect(seen).toEqual({ value: null });
  });

  it("evaluates both operands before constructing either exception", () => {
    const state = fixture();
    expect(() => state.run("raise e from c")).toThrow(state.signal);
    expect(state.events).toEqual(["eval:e", "eval:c", "call:C", "call:D", "setCause", "raise"]);
    expect(state.output()).toEqual({ type: state.C, exception: state.value });
    expect(state.assignedCause()).toBe(state.cause);
  });

  it("does not instantiate the exception when cause evaluation fails", () => {
    const state = fixture(), evaluate = state.context.evaluate;
    state.context.evaluate = node => { if (node.kind === "name" && node.name === "c") throw new Error("cause evaluation"); return evaluate(node); };
    expect(() => state.run("raise e from c")).toThrow("cause evaluation");
    expect(state.events).toEqual(["eval:e"]);
  });

  it("evaluates cause before rejecting an invalid main exception", () => {
    const state = fixture(); state.inputs.set("e", 3);
    expect(() => state.run("raise e from c")).toThrow("exceptions must derive from BaseException");
    expect(state.events).toEqual(["eval:e", "eval:c"]);
  });

  it("preserves instance identity and does not instantiate existing causes", () => {
    const state = fixture(); state.inputs.set("e", state.value); state.inputs.set("c", state.cause);
    expect(() => state.run("raise e from c")).toThrow(state.signal);
    expect(state.events).toEqual(["eval:e", "eval:c", "setCause", "raise"]);
    expect(state.output()).toEqual({ type: state.C, exception: state.value });
  });

  it("distinguishes an absent cause from explicit None", () => {
    const state = fixture();
    expect(() => state.run("raise e")).toThrow(state.signal);
    expect(state.assignedCause()).toBe("unchanged");
    expect(() => state.run("raise e from None")).toThrow(state.signal);
    expect(state.assignedCause()).toBeNull();
  });

  it("rejects invalid causes after constructing the main exception", () => {
    const state = fixture(); state.inputs.set("c", 4);
    expect(() => state.run("raise e from c")).toThrow("exception causes must derive from BaseException");
    expect(state.events).toEqual(["eval:e", "eval:c", "call:C"]);
    expect(state.assignedCause()).toBe("unchanged");
  });

  it.each(["main", "cause"])("validates the %s class constructor result and formats both class representations", which => {
    const state = fixture(); state.constructors.set(which === "main" ? state.C : state.D, 3);
    expect(() => state.run("raise e from c")).toThrow(`calling ${which === "main" ? "C" : "D"} should have returned an instance of BaseException, not int`);
    expect(state.events.slice(-2)).toEqual([`repr:${which === "main" ? "C" : "D"}`, "repr:int"]);
    expect(state.events).not.toContain("setCause");
  });

  it("retains the requested class when construction returns a different exception type", () => {
    const state = fixture(); state.constructors.set(state.C, state.cause);
    expect(() => state.run("raise e")).toThrow(state.signal);
    expect(state.output()).toEqual({ type: state.C, exception: state.cause });
  });

  it("propagates constructor failures without mutating cause", () => {
    const state = fixture(); state.context.call = () => { throw new Error("constructor failed"); };
    expect(() => state.run("raise e from c")).toThrow("constructor failed");
    expect(state.assignedCause()).toBe("unchanged");
  });

  it("reraises the active instance without evaluation, construction or normalization", () => {
    const state = fixture(); state.active(state.value);
    expect(() => state.run("raise")).toThrow(state.signal);
    expect(state.events).toEqual(["reraise"]);
    expect(state.output()).toBe(state.value);
  });

  it("does not confuse an undefined adapter payload with a missing active exception", () => {
    const state = fixture(); state.active(undefined);
    expect(() => state.run("raise")).toThrow(state.signal);
    expect(state.events).toEqual(["reraise"]);
  });

  it("reports RuntimeError when there is no exception to reraise", () => {
    expect(() => fixture().run("raise")).toThrow(expect.objectContaining({ name: "RuntimeError", message: "No active exception to reraise" }));
  });

  it("checks limits before evaluation and before constructing classes", () => {
    const empty = fixture(0);
    expect(() => empty.run("raise e")).toThrow("execution step limit exceeded");
    expect(empty.events).toEqual([]);
    const state = fixture(2);
    expect(() => state.run("raise e from c")).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["eval:e", "eval:c"]);
  });
});

describe("resumable raise execution", () => {
  it("evaluates both yielded operands before constructing or assigning cause", () => {
    const state = fixture(), cursor = state.continuation("raise (yield e) from (yield c)");
    expect(state.events).toEqual([]);
    expect(cursor.next()).toEqual({ done: false, value: state.C });
    expect(cursor.next(state.C)).toEqual({ done: false, value: state.D });
    expect(state.events).toEqual(["eval:e", "eval:c"]);
    expect(() => cursor.next(state.D)).toThrow(state.signal);
    expect(state.events).toEqual(["eval:e", "eval:c", "call:C", "call:D", "setCause", "raise"]);
    expect(state.assignedCause()).toBe(state.cause);
  });

  it("propagates an injected cause failure without constructing either exception", () => {
    const state = fixture(), cursor = state.continuation("raise e from (yield c)"), failure = Error("cause input");
    expect(cursor.next()).toEqual({ done: false, value: state.D });
    expect(() => cursor.throw(failure)).toThrow(failure);
    expect(state.events).toEqual(["eval:e", "eval:c"]); expect(state.assignedCause()).toBe("unchanged");
  });
});
