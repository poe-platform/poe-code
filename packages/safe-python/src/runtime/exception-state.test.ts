import { describe, expect, it } from "vitest";
import { HandledExceptionState, type ExceptionLinks } from "./exception-state.js";
import { ExecutionBudget } from "./execution-budget.js";
import { executeStatements } from "./statement-execution.js";
import { parseModule } from "../module.js";

interface Fault { name: string; context: Fault | null; cause: Fault | null; suppressed: boolean; }
const fault = (name: string): Fault => ({ name, context: null, cause: null, suppressed: false });
const links: ExceptionLinks<Fault> = { get: error => error.context, set: (error, context) => { error.context = context; } };
const budget = (maxSteps = 10000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 });

describe("handled exception state", () => {
  it("restores nested handled exceptions and keeps independent executions isolated", () => {
    const state = new HandledExceptionState<Fault>(), other = new HandledExceptionState<Fault>();
    const first = fault("first"), second = fault("second");
    const restoreFirst = state.enter(first), restoreSecond = state.enter(second);
    expect(state.active).toBe(second);
    expect(other.active).toBeNull();
    restoreSecond(); expect(state.active).toBe(first);
    restoreFirst(); expect(state.active).toBeNull();
    restoreSecond(); expect(state.active).toBeNull();
  });

  it("links a newly raised exception to the active handled exception", () => {
    const state = new HandledExceptionState<Fault>(), active = fault("active"), raised = fault("raised");
    state.enter(active); state.chain(raised, links, budget());
    expect(raised.context).toBe(active);
    expect(state.active).toBe(active);
  });

  it("leaves existing context intact without an active exception or on a self-raise", () => {
    const state = new HandledExceptionState<Fault>(), previous = fault("previous"), raised = fault("raised");
    raised.context = previous;
    state.chain(raised, links, budget()); expect(raised.context).toBe(previous);
    state.enter(raised); state.chain(raised, links, budget()); expect(raised.context).toBe(previous);
  });

  it("replaces old context without changing explicit cause or suppression", () => {
    const state = new HandledExceptionState<Fault>(), active = fault("active"), raised = fault("raised"), previous = fault("previous");
    raised.context = previous; raised.cause = previous; raised.suppressed = true;
    state.enter(active); state.chain(raised, links, budget());
    expect(raised).toEqual({ name: "raised", context: active, cause: previous, suppressed: true });
  });

  it("breaks the link that would create a new cycle", () => {
    const state = new HandledExceptionState<Fault>(), active = fault("active"), middle = fault("middle"), raised = fault("raised");
    active.context = middle; middle.context = raised;
    state.enter(active); state.chain(raised, links, budget());
    expect(raised.context).toBe(active); expect(active.context).toBe(middle); expect(middle.context).toBeNull();
  });

  it("terminates on an unrelated pre-existing context cycle without changing it", () => {
    const state = new HandledExceptionState<Fault>(), active = fault("active"), first = fault("first"), second = fault("second"), raised = fault("raised");
    active.context = first; first.context = second; second.context = first;
    state.enter(active); state.chain(raised, links, budget());
    expect(raised.context).toBe(active); expect(first.context).toBe(second); expect(second.context).toBe(first);
  });

  it("detects the raised object even when it lies within a pre-existing cycle", () => {
    const state = new HandledExceptionState<Fault>(), active = fault("active"), first = fault("first"), second = fault("second"), raised = fault("raised");
    active.context = first; first.context = second; second.context = raised; raised.context = first;
    state.enter(active); state.chain(raised, links, budget());
    expect(raised.context).toBe(active); expect(second.context).toBeNull();
  });

  it("meters long chains and stops before mutation when the scan exhausts its budget", () => {
    const state = new HandledExceptionState<Fault>(), raised = fault("raised");
    let active = fault("tail");
    for (let i = 0; i < 10000; i++) active = { ...fault(String(i)), context: active };
    state.enter(active);
    expect(() => state.chain(raised, links, budget(50))).toThrow("execution step limit exceeded");
    expect(raised.context).toBeNull();
    state.chain(raised, links, budget(30000)); expect(raised.context).toBe(active);
  });

  it("checks the budget before metadata access or writes", () => {
    const state = new HandledExceptionState<Fault>(); state.enter(fault("active"));
    const forbidden = () => { throw new Error("metadata accessed"); };
    expect(() => state.chain(fault("raised"), { get: forbidden, set: forbidden }, budget(0))).toThrow("execution step limit exceeded");
  });

  it("supplies active state and implicit chaining to the statement engine", () => {
    const state = new HandledExceptionState<Fault>(), first = fault("first"), second = fault("second"), meter = budget();
    expect(() => executeStatements(parseModule("try:\n  first\nfinally:\n  second").body, {
      evaluate: () => null, test: () => false, iterate: () => { throw new Error("unused"); }, assign: () => {},
      execute: statement => {
        if (statement.kind !== "expression-statement" || statement.expression.kind !== "name") throw new Error("fixture");
        const error = statement.expression.name === "first" ? first : second;
        state.chain(error, links, meter); throw error;
      },
      exceptions: { isGuest: error => error === first || error === second, enter: error => state.enter(error as Fault) }
    }, meter)).toThrow(expect.objectContaining({ name: "second" }));
    expect(second.context).toBe(first);
    expect(state.active).toBeNull();
  });
});
