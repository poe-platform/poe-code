import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregatedCell } from "../types.js";
import { renderMatrixTable } from "./render-table.js";

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

    expect(report).toContain("tests:cfg3/exec3 judge:cfg3/exec2/skip1");
    expect(report).toMatchSnapshot();
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
