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

  it("renders detailed run metric and integrity evidence", () => {
    const report = renderRunsMarkdown([
      {
        ...runFixture(),
        error: "evaluation failed",
        metrics: [
          {
            id: "tool_correctness",
            enabled: true,
            required: true,
            weight: 1,
            score: 0.5,
            threshold: 0.8,
            passed: false,
            status: "executed",
            reason: "One risky tool call failed.",
            traceReferences: [2]
          }
        ],
        cheated: true,
        cheatReport: {
          cheated: true,
          violations: [{ path: "/private/key", toolCall: "read", reason: "outside-clone" }],
          uninspectable: [{ toolCall: "exec", operation: "exec", reason: "shell-command" }]
        },
        trace: { available: true, eventCount: 3, toolEventCount: 1, errorEventCount: 1 }
      }
    ]);

    expect(report).toContain("### Run `run-1`");
    expect(report).toContain("`tool_correctness`: 0.5 (fail, executed)");
    expect(report).toContain("One risky tool call failed.");
    expect(report).toContain("trace events `2`");
    expect(report).toContain("/private/key");
    expect(report).toContain("shell-command");
    expect(report).toContain("evaluation failed");
  });

  it("renders skipped metrics without synthetic scores", () => {
    const report = renderRunsMarkdown([
      {
        ...runFixture(),
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
        }]
      }
    ]);

    expect(report).toContain("`task_completion`: skipped — budget exceeded");
    expect(report).not.toContain("`task_completion`: 0.0");
  });

  it("omits missing metric reasons from detailed output", () => {
    const report = renderRunsMarkdown([
      {
        ...runFixture(),
        metrics: [{
          id: "task_completion",
          enabled: true,
          required: true,
          weight: 1,
          score: 1,
          threshold: 0.8,
          passed: true,
          status: "executed"
        }]
      }
    ]);

    expect(report).toContain("`task_completion`: 1.0 (pass, executed)");
    expect(report).not.toContain("undefined");
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
