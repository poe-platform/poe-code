import { describe, expect, it, vi } from "vitest";

import { Budget, SandboxError } from "../../src/interp/budget.js";
import { run } from "../../src/run.js";

describe("budget integration", () => {
  it("allows a script that visits exactly maxSteps and rejects one additional visit", async () => {
    await expect(
      run("return 1", {
        budget: new Budget({
          maxSteps: 2
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1,
      stats: {
        nodeVisits: 2
      }
    });

    await expectSandboxBudgetError(
      "return 1 + 2",
      {
        budget: new Budget({
          maxSteps: 2
        })
      },
      {
        budget: "steps",
        current: 3,
        limit: 2,
        message: "Sandbox budget exceeded for steps: 3 > 2."
      }
    );
  });

  it("allows string concatenation at the limit and rejects one code unit beyond it", async () => {
    await expect(
      run("return 'ab' + 'cd'", {
        budget: new Budget({
          stringLength: 4
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "abcd"
    });

    await expectSandboxBudgetError(
      "return 'ab' + 'cde'",
      {
        budget: new Budget({
          stringLength: 4
        })
      },
      {
        budget: "stringLength",
        current: 5,
        limit: 4,
        message: "Sandbox budget exceeded for stringLength: 5 > 4."
      }
    );
  });

  it("allows array literals at the limit and rejects one element beyond it", async () => {
    await expect(
      run("return [1, 2, 3]", {
        budget: new Budget({
          arrayLength: 3
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3]
    });

    await expectSandboxBudgetError(
      "return [1, 2, 3, 4]",
      {
        budget: new Budget({
          arrayLength: 3
        })
      },
      {
        budget: "arrayLength",
        current: 4,
        limit: 3,
        message: "Sandbox budget exceeded for arrayLength: 4 > 3."
      }
    );
  });

  it("allows recursion at maxCallDepth and rejects one deeper call", async () => {
    await expect(
      run("const recur = n => n === 0 ? 0 : recur(n - 1); return recur(3)", {
        budget: new Budget({
          maxCallDepth: 4
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 0
    });

    await expectSandboxBudgetError(
      "const recur = n => n === 0 ? 0 : recur(n - 1); return recur(4)",
      {
        budget: new Budget({
          maxCallDepth: 4
        })
      },
      {
        budget: "callDepth",
        current: 5,
        limit: 4,
        message: "Sandbox budget exceeded for callDepth: 5 > 4."
      }
    );
  });

  it("throws a deadline budget error within the sampling window when already past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:00:00.001Z"));

    try {
      await expectSandboxBudgetError(
        "for (let index = 0; index < 2_000; index += 1) {} return 1",
        {
          budget: new Budget({
            deadline: new Date("2026-05-17T00:00:00.000Z")
          })
        },
        {
          budget: "deadline",
          current: new Date("2026-05-17T00:00:00.001Z").getTime(),
          limit: new Date("2026-05-17T00:00:00.000Z").getTime(),
          message: "Sandbox budget exceeded for deadline: 1778976000001 > 1778976000000."
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws a deadline budget error mid-execution while still running finally blocks", async () => {
    const record = vi.fn();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:00:00.000Z"));

    try {
      await expectSandboxBudgetError(
        [
          "try {",
          "  advancePastDeadline();",
          "  for (let index = 0; index < 2_000; index += 1) {}",
          "  record('after');",
          "} finally {",
          "  record('finally');",
          "}"
        ].join("\n"),
        {
          bindings: {
            advancePastDeadline: () => {
              vi.setSystemTime(new Date("2026-05-17T00:00:00.001Z"));
            },
            record
          },
          budget: new Budget({
            deadline: new Date("2026-05-17T00:00:00.000Z")
          })
        },
        {
          budget: "deadline",
          current: new Date("2026-05-17T00:00:00.001Z").getTime(),
          limit: new Date("2026-05-17T00:00:00.000Z").getTime(),
          message: "Sandbox budget exceeded for deadline: 1778976000001 > 1778976000000."
        }
      );
    } finally {
      vi.useRealTimers();
    }

    expect(record.mock.calls).toEqual([["finally"]]);
  });

  it("starts each run with a fresh budget when reusing a Budget instance", async () => {
    const budget = new Budget({
      maxSteps: 2
    });

    await expect(run("return 1", { budget })).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
    await expect(run("return 2", { budget })).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("counts array literal spread elements after flattening", async () => {
    await expect(
      run("return [0, ...[1, 2]]", {
        budget: new Budget({
          arrayLength: 3
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0, 1, 2]
    });

    await expectSandboxBudgetError(
      "return [0, ...[1, 2]]",
      {
        budget: new Budget({
          arrayLength: 2
        })
      },
      {
        budget: "arrayLength",
        current: 3,
        limit: 2,
        message: "Sandbox budget exceeded for arrayLength: 3 > 2."
      }
    );
  });

  it("renders host error excerpts after string budget exhaustion", async () => {
    const result = await run("try { explode(); } catch ({ stack }) { return stack; }", {
      bindings: {
        explode: () => {
          throw new Error("render this error");
        }
      },
      budget: new Budget({
        stringLength: 1
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.returnValue).toBe("Error: render this error\n    at explode (line 1, column 7)");
  });

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
      ['record("before");', "'x'.repeat(20971520);", 'record("after");'].join("\n"),
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
