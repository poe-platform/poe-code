import { describe, expect, it } from "vitest";

import { aggregateRuns } from "./aggregate.js";
import type { EvalRunResult } from "./types.js";

function run(
  overrides: Partial<Omit<EvalRunResult, "tests">> & {
    tests?: Partial<EvalRunResult["tests"]>;
  }
): EvalRunResult {
  const { tests, ...rest } = overrides;
  return {
    runId: "run-1",
    eval: "eval-1",
    agent: "codex",
    model: "gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 100,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      costUsd: 0.1
    },
    tests: {
      passed: 1,
      total: 1,
      pass_rate: 1,
      cases: [],
      ...tests
    },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled",
        reason: "disabled"
      }
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    ...rest
  };
}

describe("aggregateRuns", () => {
  it("aggregates three mixed runs into mean, min, and max stats", () => {
    const result = aggregateRuns([
      run({
        runId: "run-1",
        correctness: 0.25,
        iterations: 1,
        durationMs: 100,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 10,
          costUsd: 0.125
        },
        tests: {
          passed: 1,
          total: 4
        },
        judge: {
          completeness: 0.2,
          mean: 0.25
        }
      }),
      run({
        runId: "run-2",
        correctness: 0.5,
        iterations: 3,
        durationMs: 300,
        usage: {
          inputTokens: 200,
          outputTokens: 100,
          cachedTokens: 20,
          costUsd: 0.25
        },
        tests: {
          passed: 3,
          total: 4
        },
        judge: {
          completeness: 0.4,
          mean: 0.5
        }
      }),
      run({
        runId: "run-3",
        correctness: 1,
        iterations: 5,
        durationMs: 500,
        usage: {
          inputTokens: 300,
          outputTokens: 150,
          cachedTokens: 30,
          costUsd: 0.375
        },
        tests: {
          passed: 4,
          total: 4
        },
        judge: {
          completeness: 0.6,
          mean: 0.75
        }
      })
    ]);

    expect(result).toEqual({
      cell: {
        eval: "eval-1",
        agent: "codex",
        model: "gpt-5",
        planKind: "plan"
      },
      repeats: 3,
      runIds: ["run-1", "run-2", "run-3"],
      cheated_any: false,
      verdicts: { pass: 3, fail: 0, error: 0, cheated: 0, budget_exceeded: 0 },
      iterations: {
        mean: 3,
        min: 1,
        max: 5
      },
      durationMs: {
        mean: 300,
        min: 100,
        max: 500
      },
      usage: {
        inputTokens: {
          mean: 200,
          min: 100,
          max: 300
        },
        outputTokens: {
          mean: 100,
          min: 50,
          max: 150
        },
        cachedTokens: {
          mean: 20,
          min: 10,
          max: 30
        },
        costUsd: {
          mean: 0.25,
          min: 0.125,
          max: 0.375
        }
      },
      tests: {
        passRateMean: 2 / 3,
        passRateMin: 0.25,
        passRateMax: 1
      },
      correctness: {
        mean: 7 / 12,
        min: 0.25,
        max: 1
      },
      scoring: {
        tests: { configured: 3, executed: 3, skipped: 0, failed: 0, disabled: 0 },
        judge: { configured: 3, executed: 0, skipped: 0, failed: 0, disabled: 3 }
      },
      judge: {
        mean: {
          mean: 0.5,
          min: 0.25,
          max: 0.75
        }
      }
    });
  });

  it("collapses a single run to identical mean, min, and max stats", () => {
    const result = aggregateRuns([
      run({
        iterations: 7,
        durationMs: 1234,
        usage: {
          inputTokens: 321,
          outputTokens: 123,
          cachedTokens: 0,
          costUsd: 0.05
        },
        tests: {
          passed: 2,
          total: 5
        },
        correctness: 0.4
      })
    ]);

    expect(result.iterations).toEqual({ mean: 7, min: 7, max: 7 });
    expect(result.durationMs).toEqual({ mean: 1234, min: 1234, max: 1234 });
    expect(result.usage.inputTokens).toEqual({ mean: 321, min: 321, max: 321 });
    expect(result.usage.outputTokens).toEqual({ mean: 123, min: 123, max: 123 });
    expect(result.usage.cachedTokens).toEqual({ mean: 0, min: 0, max: 0 });
    expect(result.usage.costUsd).toEqual({ mean: 0.05, min: 0.05, max: 0.05 });
    expect(result.tests).toEqual({
      passRateMean: 0.4,
      passRateMin: 0.4,
      passRateMax: 0.4
    });
    expect(result.correctness).toEqual({ mean: 0.4, min: 0.4, max: 0.4 });
  });

  it("throws when runs disagree on the aggregate cell", () => {
    expect(() =>
      aggregateRuns([
        run({ runId: "run-1" }),
        run({
          runId: "run-2",
          model: "other-model"
        })
      ])
    ).toThrow("Cannot aggregate runs with different model values");
  });

  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true]
  ])("sets cheated_any for %s and %s to %s", (first, second, expected) => {
    expect(
      aggregateRuns([
        run({
          runId: "run-1",
          cheated: first
        }),
        run({
          runId: "run-2",
          cheated: second
        })
      ]).cheated_any
    ).toBe(expected);
  });

  it("omits judge when any run lacks a judge mean", () => {
    const result = aggregateRuns([
      run({
        runId: "run-1",
        judge: {
          mean: 0.5
        }
      }),
      run({
        runId: "run-2",
        judge: undefined
      })
    ]);

    expect(result.judge).toBeUndefined();
  });

  it("counts executed and skipped scoring components separately", () => {
    const result = aggregateRuns([
      run({
        runId: "run-1",
        scoring: {
          tests: {
            configured: true,
            required: true,
            configuredWeight: 0.7,
            effectiveWeight: 0.7,
            status: "executed"
          },
          judge: {
            configured: true,
            required: false,
            configuredWeight: 0.3,
            effectiveWeight: 0.3,
            status: "executed"
          }
        }
      }),
      run({
        runId: "run-2",
        scoring: {
          tests: {
            configured: true,
            required: true,
            configuredWeight: 0.7,
            effectiveWeight: 1,
            status: "executed"
          },
          judge: {
            configured: true,
            required: false,
            configuredWeight: 0.3,
            effectiveWeight: 0,
            status: "skipped",
            reason: "budget_exceeded"
          }
        },
        verdict: "budget_exceeded"
      })
    ]);

    expect(result.scoring).toEqual({
      tests: { configured: 2, executed: 2, skipped: 0, failed: 0, disabled: 0 },
      judge: { configured: 2, executed: 1, skipped: 1, failed: 0, disabled: 0 }
    });
    expect(result.verdicts).toMatchObject({ pass: 1, budget_exceeded: 1 });
  });

  it("treats omitted optional usage metrics as zero", () => {
    const result = aggregateRuns([
      run({
        runId: "run-1",
        usage: {
          inputTokens: 1,
          outputTokens: 2
        }
      }),
      run({
        runId: "run-2",
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          cachedTokens: 6,
          costUsd: 0.2
        }
      })
    ]);

    expect(result.usage.cachedTokens).toEqual({ mean: 3, min: 0, max: 6 });
    expect(result.usage.costUsd).toEqual({ mean: 0.1, min: 0, max: 0.2 });
  });

  it("throws for empty input", () => {
    expect(() => aggregateRuns([])).toThrow("Cannot aggregate zero runs");
  });
});
