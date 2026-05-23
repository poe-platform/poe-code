import { describe, expect, it } from "vitest";
import type { AggregatedCell, EvalRunResult } from "../types.js";
import { renderMatrixMarkdown, renderRunsMarkdown } from "./render-md.js";

describe("renderMatrixMarkdown", () => {
  it("renders a fixed matrix fixture as a GitHub-flavored pipe table", () => {
    expect(renderMatrixMarkdown([cellFixture()])).toMatchSnapshot();
  });

  it("renders per-run scoring component states", () => {
    expect(renderRunsMarkdown([runFixture()])).toContain("tests:cfg/executed judge:cfg/disabled");
  });
});

function runFixture(): EvalRunResult {
  return {
    runId: "run-1",
    eval: "task-alpha",
    planKind: "plan",
    agent: "codex",
    model: "gpt-5",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 1000,
    usage: { inputTokens: 2, outputTokens: 3 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
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
        status: "disabled",
        reason: "disabled"
      }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] }
  };
}

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
