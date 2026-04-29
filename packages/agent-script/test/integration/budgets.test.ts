import { describe, expect, it, vi } from "vitest";

import { Budget, SandboxError } from "../../src/interp/budget.js";
import { run } from "../../src/run.js";

describe("budget integration", () => {
  it("fails an infinite loop with a step-budget SandboxError before later host effects", async () => {
    const record = vi.fn();

    await expectSandboxBudgetError(
      [
        'record("before");',
        "await (async (loop) => await loop(loop))(async (loop) => await loop(loop));",
        'record("after");'
      ].join("\n"),
      {
        bindings: {
          record
        },
        budget: new Budget({
          maxSteps: 40
        })
      },
      {
        budget: "steps",
        current: 41,
        limit: 40,
        message: "Sandbox budget exceeded for steps: 41 > 40."
      }
    );

    expect(record.mock.calls).toEqual([["before"]]);
  });

  it("fails a 20MB string build with a string-length SandboxError before later host effects", async () => {
    const record = vi.fn();

    await expectSandboxBudgetError(
      [
        'record("before");',
        "'x'.repeat(20971520);",
        'record("after");'
      ].join("\n"),
      {
        bindings: {
          record
        },
        budget: new Budget({
          stringLength: 1048576
        })
      },
      {
        budget: "stringLength",
        current: 20971520,
        limit: 1048576,
        message: "Sandbox budget exceeded for stringLength: 20971520 > 1048576."
      }
    );

    expect(record.mock.calls).toEqual([["before"]]);
  });

  it("fails recursion with a call-depth SandboxError before later host effects", async () => {
    const record = vi.fn();

    await expectSandboxBudgetError(
      [
        'record("before");',
        "await (async (loop) => await loop(loop))(async (loop) => await loop(loop));",
        'record("after");'
      ].join("\n"),
      {
        bindings: {
          record
        },
        budget: new Budget({
          maxCallDepth: 10
        })
      },
      {
        budget: "callDepth",
        current: 11,
        limit: 10,
        message: "Sandbox budget exceeded for callDepth: 11 > 10."
      }
    );

    expect(record.mock.calls).toEqual([["before"]]);
  });
});

async function expectSandboxBudgetError(
  source: string,
  options: Parameters<typeof run>[1],
  expected: Pick<SandboxError, "budget" | "current" | "limit" | "message">
): Promise<void> {
  try {
    await run(source, options);
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxError);
    expect(error).toMatchObject({
      code: "budgetExceeded",
      ...expected
    } satisfies Partial<SandboxError>);
    return;
  }

  throw new Error("Expected a SandboxError to be thrown.");
}
