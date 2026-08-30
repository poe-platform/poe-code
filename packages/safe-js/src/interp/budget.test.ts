import { describe, expect, it, vi } from "vitest";

import { allocateRegexSteps, Budget, REGEX_STEP_LIMIT, SandboxError } from "./budget.js";
import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createSandboxRegex, isSandboxClosure, measureSandboxData } from "./values.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { Scope } from "./scope.js";

async function observeCompileCleanup() {
  const budget = new Budget({ dataSize: 10 });
  budget.reconcileDataUsage(8);
  const regex = createSandboxRegex("a");
  const primary = new Error("primary");
  const unrelated = {};
  const globals = createConsoleJsonGlobals({
    budget,
    sink: { log: () => undefined, error: () => undefined }
  });
  const log = globals.console.log;
  if (!isSandboxClosure(log)) throw new Error("Missing console.log");
  let stepsAtThrow = 0;
  const native = vi.spyOn(globalThis, "RegExp").mockImplementation(function () {
    const resume = budget.suspendChecks();
    budget.setRetainedDataUsage(unrelated, 10);
    resume();
    stepsAtThrow = budget.stepsUsed;
    throw primary;
  });
  let result: unknown;
  try {
    result = log.call([regex]);
  } finally {
    native.mockRestore();
  }
  const failure = await Promise.resolve(result).then(
    () => undefined,
    (reason: unknown) => reason
  );
  return { budget, primary, failure, stepsAtThrow };
}

describe("compile preimage budget", () => {
  it("CONTROL cleanup preserves primary failure, unrelated charges and work", async () => {
    const receipt = await observeCompileCleanup();
    expect(receipt.failure).toBe(receipt.primary);
    expect(receipt.budget.currentDataSize).toBe(18);
    expect(receipt.budget.stepsUsed).toBe(receipt.stepsAtThrow);
  });
  it("RED native compile is reserved before constructor failure", async () => {
    const receipt = await observeCompileCleanup();
    expect(receipt.failure).toBe(receipt.primary);
    expect(receipt.budget.currentDataSize).toBe(18);
    expect(receipt.budget.peakDataSize).toBe(20);
  });
  it("RED stale provisional release cannot overwrite a reused Budget", () => {
    const budget = new Budget();
    budget.reconcileDataUsage(3);
    const release = budget.provisionDataUsage(2);
    budget.reset();
    budget.reconcileDataUsage(7);
    release();
    release();
    expect(budget.currentDataSize).toBe(7);
  });
  it.each(["return /a/", "return await (async () => { await 1; return /a/; })()"])(
    "RED nonzero provisional release preserves completed result: %s",
    async (source) => {
      const budget = new Budget({ dataSize: 1000 });
      const base = "x".repeat(100);
      const sibling = createSandboxRegex("b");
      const baseline = measureSandboxData([base, sibling]);
      expect(measureSandboxData([base, sibling, sibling])).toBe(baseline);
      const scope = new Scope({ base, sibling, alias: sibling });
      expect(measureSandboxData(scope.retainedValues())).toBe(baseline);
      budget.reconcileDataUsage(baseline);
      const release = budget.provisionDataUsage(3);
      const statement = parseModule(source).body[0];
      if (statement.type !== "ReturnStatement") throw new Error("Missing return statement");
      const result = await interpret(statement, { budget, scope, useScopeDirectly: true });
      expect(result).toMatchObject({ ok: true, returnValue: { source: "a" } });
      const retained = budget.currentDataSize;
      expect(retained).toBeGreaterThan(baseline);
      const work = budget.stepsUsed;
      release();
      release();
      expect(budget.currentDataSize).toBe(retained);
      expect(budget.stepsUsed).toBe(work);
      const fresh = parseModule("return alias").body[0];
      if (fresh.type !== "ReturnStatement") throw new Error("Missing return statement");
      const measured = await interpret(fresh, { budget, scope, useScopeDirectly: true });
      expect(measured).toMatchObject({ ok: true, returnValue: sibling });
      expect(budget.currentDataSize).toBe(baseline);
    }
  );
});

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
  it("keeps runtime-retained data charged across scope reconciliation", () => {
    const budget = new Budget({ dataSize: 10 });
    const owner = {};
    budget.reconcileDataUsage(4);
    budget.setRetainedDataUsage(owner, 5);
    expect(budget.currentDataSize).toBe(9);
    budget.reconcileDataUsage(3);
    expect(budget.currentDataSize).toBe(8);
    expectSandboxError(() => budget.reconcileDataUsage(6), {
      budget: "dataSize",
      current: 11,
      limit: 10
    });
    expectSandboxError(() => budget.setRetainedDataUsage(owner, 8), {
      budget: "dataSize",
      current: 11,
      limit: 10
    });
    expect(budget.currentDataSize).toBe(8);
    budget.setRetainedDataUsage(owner, 0);
    expect(budget.currentDataSize).toBe(3);
    expect(budget.peakDataSize).toBe(9);
  });

  it("preserves retained charges when provisional data is released and clears them on reset", () => {
    const budget = new Budget({ dataSize: 20 });
    budget.reconcileDataUsage(2);
    const release = budget.provisionDataUsage(3);
    budget.setRetainedDataUsage({}, 4);
    release();
    release();
    expect(budget.currentDataSize).toBe(6);
    budget.reset();
    budget.reconcileDataUsage(1);
    expect(budget.currentDataSize).toBe(1);
  });

  it.each([
    { option: "maxSteps", value: Number.NaN },
    { option: "maxSteps", value: Number.POSITIVE_INFINITY },
    { option: "maxSteps", value: -1 },
    { option: "maxSteps", value: 1.5 },
    { option: "maxCallDepth", value: Number.NaN },
    { option: "stringLength", value: Number.NaN },
    { option: "arrayLength", value: Number.NaN },
    { option: "dataSize", value: Number.NaN }
  ])("rejects invalid $option limit $value", ({ option, value }) => {
    expect(() => new Budget({ [option]: value })).toThrow(
      `${option} must be a non-negative integer.`
    );
  });

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

  it("fails visits within the deadline sampling window once the wallclock deadline has passed", () => {
    const budget = new Budget({
      deadline: Date.now() - 1
    });

    expectSandboxError(
      () => {
        for (let visit = 0; visit < 1_024; visit += 1) {
          budget.visitNode();
        }
      },
      { budget: "deadline" }
    );
  });

  it("does not fail deadline checks across many visits with a generous deadline", () => {
    const budget = new Budget({
      deadline: Date.now() + 60_000
    });
    const dateNow = vi.spyOn(Date, "now");

    try {
      expect(() => {
        for (let visit = 0; visit < 10_000; visit += 1) {
          budget.visitNode();
        }
      }).not.toThrow();
      expect(dateNow.mock.calls.length).toBeGreaterThan(0);
      expect(dateNow.mock.calls.length).toBeLessThanOrEqual(10);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("does not fail deadline checks while deadline checks are suspended", () => {
    const budget = new Budget({
      deadline: Date.now() - 1
    });

    for (let visit = 0; visit < 1_023; visit += 1) {
      budget.visitNode();
    }

    const resumeDeadlineChecks = budget.suspendDeadlineChecks();

    expect(() => {
      for (let visit = 0; visit < 10_000; visit += 1) {
        budget.visitNode();
      }
    }).not.toThrow();

    resumeDeadlineChecks();
    expectSandboxError(() => budget.visitNode(), { budget: "deadline" });
  });

  it("does not fail deadline checks while all checks are suspended", () => {
    const budget = new Budget({
      deadline: Date.now() - 1
    });
    const resumeChecks = budget.suspendChecks();

    expect(() => {
      for (let visit = 0; visit < 10_000; visit += 1) {
        budget.visitNode();
      }
    }).not.toThrow();

    resumeChecks();
    expectSandboxError(
      () => {
        for (let visit = 0; visit < 1_024; visit += 1) {
          budget.visitNode();
        }
      },
      { budget: "deadline" }
    );
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

  it("checks collection allocations against the configured array budget", () => {
    const budget = new Budget({
      arrayLength: 2
    });

    expect(() => budget.allocateCollectionEntries(2)).not.toThrow();
    expectSandboxError(() => budget.allocateCollectionEntries(3), {
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

  it("uses deadline priority when deadline and step limits are crossed together", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:00:00.001Z"));

    try {
      const budget = new Budget({
        deadline: new Date("2026-05-17T00:00:00.000Z"),
        maxSteps: 1_023
      });

      expectSandboxError(
        () => {
          for (let visit = 0; visit < 1_024; visit += 1) {
            budget.visitNode();
          }
        },
        {
          budget: "deadline",
          current: new Date("2026-05-17T00:00:00.001Z").getTime(),
          limit: new Date("2026-05-17T00:00:00.000Z").getTime()
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts string budgets as UTF-16 code units instead of bytes", () => {
    const value = String.fromCodePoint(0x1f642);

    expect(new Budget({ stringLength: 2 }).allocateString(value)).toBe(value);
    expectSandboxError(() => new Budget({ stringLength: 1 }).allocateString(value), {
      budget: "stringLength",
      current: 2,
      limit: 1
    });
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

describe("allocateRegexSteps", () => {
  it("enforces the hard regex step limit", () => {
    expect(() => allocateRegexSteps(REGEX_STEP_LIMIT)).not.toThrow();
    expectSandboxError(() => allocateRegexSteps(REGEX_STEP_LIMIT + 1), {
      budget: "steps",
      current: REGEX_STEP_LIMIT + 1,
      limit: REGEX_STEP_LIMIT
    });
  });
});
