import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregatedCell } from "../types.js";
import { renderMatrixTable, renderRunsTable } from "./render-table.js";

describe("renderMatrixTable", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "0";
  });

  afterEach(() => {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
  });

  it("renders a fixed matrix fixture through the design-system table", () => {
    const report = renderMatrixTable([cellFixture()]);

    expect(report).not.toContain("Components");
    expect(report).toContain("Correct");
    expect(report).toMatchSnapshot();
  });

  it("keeps metric and integrity indicators compact", () => {
    const report = renderMatrixTable([
      {
        ...cellFixture(),
        metrics: {
          task_completion: {
            score: { mean: 0.5, min: 0, max: 1 },
            passed: 1,
            failed: 1,
            statuses: { executed: 1, skipped: 0, failed: 1, disabled: 0 }
          }
        },
        integrity: {
          cheatViolations: 1,
          uninspectableActions: 2,
          tracesAvailable: 1,
          executionErrors: 1
        }
      } as AggregatedCell
    ]);

    expect(report).toContain("task_completion:0.5!");
    expect(report).toContain("cheat:1 risky:2 trace:1/3 err:1");
  });

  it("does not render missing cost or unavailable metric scores as zero", () => {
    const report = renderRunsTable([
      {
        runId: "run-1",
        eval: "task-alpha",
        planKind: "plan",
        agent: "codex",
        model: "gpt-5",
        verdict: "error",
        correctness: 0,
        iterations: 1,
        durationMs: 1000,
        usage: { inputTokens: 2, outputTokens: 3 },
        tests: { passed: 0, total: 1, pass_rate: 0, cases: [] },
        metrics: [{
          id: "task_completion",
          enabled: true,
          required: true,
          weight: 1,
          score: 0,
          threshold: 0.8,
          passed: false,
          status: "skipped",
          reason: "budget exceeded"
        }],
        scoring: {
          tests: { configured: true, required: true, configuredWeight: 1, effectiveWeight: 1, status: "executed" },
          judge: { configured: false, required: false, configuredWeight: 0, effectiveWeight: 0, status: "disabled" }
        },
        cheated: false,
        cheatReport: { cheated: false, violations: [] }
      }
    ]);

    expect(report).toContain("task_completion:skipped");
    expect(report).not.toContain("task_completion:0.0");
    expect(report).toMatch(/│\s+-\s+│ task_completion:skipped/);
  });
});

function cellFixture(): AggregatedCell {
  return {
    cell: {
      eval: "task-alpha",
      planKind: "pipeline",
      agent: "codex",
      model: "gpt-5"
    },
    repeats: 3,
    runIds: ["run-1", "run-2", "run-3"],
    cheated_any: false,
    verdicts: { pass: 0, fail: 3, error: 0, cheated: 0, budget_exceeded: 0 },
    iterations: {
      mean: 3,
      min: 1,
      max: 5
    },
    durationMs: {
      mean: 90000,
      min: 60000,
      max: 120000
    },
    usage: {
      inputTokens: {
        mean: 1200,
        min: 1000,
        max: 1400
      },
      outputTokens: {
        mean: 800,
        min: 700,
        max: 900
      },
      cachedTokens: {
        mean: 300,
        min: 100,
        max: 500
      },
      costUsd: {
        mean: 0.45,
        min: 0.3,
        max: 0.6
      }
    },
    tests: {
      passRateMean: 2 / 3,
      passRateMin: 1 / 3,
      passRateMax: 1
    },
    correctness: {
      mean: 0.75,
      min: 0.5,
      max: 1
    },
    scoring: {
      tests: { configured: 3, executed: 3, skipped: 0, failed: 0, disabled: 0 },
      judge: { configured: 3, executed: 2, skipped: 1, failed: 0, disabled: 0 }
    },
    judge: {
      mean: {
        mean: 4.2,
        min: 3.8,
        max: 4.6
      }
    }
  };
}
