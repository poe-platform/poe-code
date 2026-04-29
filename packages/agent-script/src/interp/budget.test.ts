import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "./budget.js";

function expectSandboxError(action: () => unknown, expected: Partial<SandboxError>): void {
  try {
    action();
    throw new Error("Expected SandboxError to be thrown.");
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxError);
    expect(error).toEqual(expect.objectContaining(expected));
  }
}

describe("Budget", () => {
  it("tracks AST step usage and fails once the step limit is exceeded", () => {
    const budget = new Budget({
      maxSteps: 2
    });

    budget.visitNode();
    budget.visitNode();

    expectSandboxError(() => budget.visitNode(), {
      budget: "steps",
      current: 3,
      limit: 2
    });
    expect(budget.stepsUsed).toBe(3);
  });

  it("fails visits once the wallclock deadline has passed", () => {
    const budget = new Budget({
      deadline: Date.now() - 1
    });

    expectSandboxError(() => budget.visitNode(), {
      budget: "deadline"
    });
  });

  it("checks string allocations against the configured string budget", () => {
    const budget = new Budget({
      stringLength: 4
    });

    expectSandboxError(() => budget.allocateString("toolong"), {
      budget: "stringLength",
      current: 7,
      limit: 4
    });
  });

  it("checks array allocations against the configured array budget", () => {
    const budget = new Budget({
      arrayLength: 2
    });

    expectSandboxError(() => budget.allocateArrayLength(3), {
      budget: "arrayLength",
      current: 3,
      limit: 2
    });
  });

  it("tracks peak call depth and rejects deeper call or await paths", () => {
    const budget = new Budget({
      maxCallDepth: 1
    });

    const leaveCall = budget.enterCall();

    expect(budget.peakCallDepth).toBe(1);
    expectSandboxError(() => budget.enterAwait(), {
      budget: "callDepth",
      current: 2,
      limit: 1
    });

    leaveCall();
    expect(budget.peakCallDepth).toBe(1);
  });

  it("normalizes Date deadlines and allows values at the configured limits", () => {
    const deadline = new Date(Date.now() + 1_000);
    const budget = new Budget({
      deadline,
      stringLength: 5,
      arrayLength: 2,
      maxSteps: 1
    });

    expect(budget.deadline).toBe(deadline.getTime());
    expect(budget.allocateString("hello")).toBe("hello");
    expect(() => budget.allocateArrayLength(2)).not.toThrow();
    expect(() => budget.visitNode()).not.toThrow();
    expect(budget.stepsUsed).toBe(1);
  });

  it("does not let leaving the same depth scope twice underflow the call depth", () => {
    const budget = new Budget({
      maxCallDepth: 1
    });

    const leaveCall = budget.enterCall();

    leaveCall();
    leaveCall();

    expect(budget.currentCallDepth).toBe(0);
    expect(() => budget.enterCall()).not.toThrow();
  });
});
