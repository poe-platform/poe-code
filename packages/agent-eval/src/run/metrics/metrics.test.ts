import { describe, expect, it, vi } from "vitest";
import type { EvalDef, MetricSpec } from "../../types.js";
import type { NormalizedTrace } from "../trace/types.js";
import { executeMetrics } from "./metrics.js";

const oracleOutcome = { passed: 1, total: 1, cases: [] };

function metric(id: string, overrides: Partial<MetricSpec> = {}): MetricSpec {
  return {
    id,
    enabled: true,
    required: false,
    weight: 1,
    threshold: 0.8,
    evaluator: { kind: "deterministic", config: {} },
    ...overrides
  };
}

function trace(): NormalizedTrace {
  return {
    events: [
      { type: "tool", sequence: 1, phase: "start", name: "read", operation: "read", paths: [] },
      {
        type: "tool",
        sequence: 2,
        phase: "complete",
        name: "read",
        operation: "read",
        paths: [],
        outcome: "completed"
      },
      { type: "tool", sequence: 3, phase: "start", name: "test", operation: "exec", paths: [] },
      {
        type: "tool",
        sequence: 4,
        phase: "complete",
        name: "test",
        operation: "exec",
        paths: [],
        outcome: "failed"
      }
    ],
    usage: { inputTokens: 0, outputTokens: 0 }
  };
}

describe("executeMetrics", () => {
  it("scores deterministic P0 metrics from oracle and normalized trace facts", async () => {
    const results = await executeMetrics({
      evalDef: createEval([
        metric("task_completion", { threshold: 1 }),
        metric("tool_correctness", { threshold: 0.5 }),
        metric("step_efficiency", {
          threshold: 1,
          evaluator: { kind: "deterministic", config: { max_steps: 2 } }
        })
      ]),
      trace: trace(),
      oracleOutcome,
      agentUnderTest: "codex",
      cloneDir: "/clone",
      traceJsonPath: "/run/trace.json"
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: "task_completion",
        score: 1,
        passed: true,
        status: "executed"
      }),
      expect.objectContaining({
        id: "tool_correctness",
        score: 0.5,
        passed: true,
        status: "executed",
        traceReferences: [2, 4]
      }),
      expect.objectContaining({ id: "step_efficiency", score: 1, passed: true, status: "executed" })
    ]);
  });

  it("reports disabled metrics and required threshold failures without changing their scores", async () => {
    const results = await executeMetrics({
      evalDef: createEval([
        metric("task_completion", { enabled: false, required: true }),
        metric("tool_correctness", { required: true, threshold: 0.75 })
      ]),
      trace: trace(),
      oracleOutcome,
      agentUnderTest: "codex",
      cloneDir: "/clone",
      traceJsonPath: "/run/trace.json"
    });

    expect(results[0]).toMatchObject({ id: "task_completion", status: "disabled", passed: false });
    expect(results[1]).toMatchObject({
      id: "tool_correctness",
      status: "executed",
      score: 0.5,
      passed: false,
      required: true
    });
  });

  it("executes judge-backed metrics with task, oracle outcome, and normalized trace", async () => {
    const judge = vi.fn().mockResolvedValue({
      score: 0.9,
      reason: "Followed the planned sequence.",
      traceReferences: [1]
    });
    const results = await executeMetrics({
      evalDef: createEval([
        metric("plan_adherence", {
          evaluator: {
            kind: "judge",
            agent: "codex",
            model: "judge-model",
            instructions: "Assess adherence."
          }
        })
      ]),
      trace: trace(),
      oracleOutcome,
      agentUnderTest: "codex",
      cloneDir: "/clone",
      traceJsonPath: "/run/trace.json",
      judge
    });

    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: expect.objectContaining({ id: "plan_adherence" }),
        oracleOutcome,
        trace: trace(),
        evalDef: expect.objectContaining({
          plan: expect.objectContaining({ body: "Do the task." })
        })
      })
    );
    expect(results[0]).toMatchObject({
      id: "plan_adherence",
      score: 0.9,
      threshold: 0.8,
      passed: true,
      status: "executed"
    });
  });

  it("returns stable failed results when a judge-backed metric errors", async () => {
    const results = await executeMetrics({
      evalDef: createEval([
        metric("plan_adherence", { required: true, evaluator: { kind: "judge" } })
      ]),
      trace: trace(),
      oracleOutcome,
      agentUnderTest: "codex",
      cloneDir: "/clone",
      traceJsonPath: "/run/trace.json",
      judge: vi.fn().mockRejectedValue(new Error("judge unavailable"))
    });

    expect(results[0]).toMatchObject({
      id: "plan_adherence",
      score: 0,
      passed: false,
      status: "failed",
      reason: "judge unavailable"
    });
  });

  it("keeps a required judge-backed metric visible when judging is disabled", async () => {
    const results = await executeMetrics({
      evalDef: createEval([
        metric("plan_adherence", { required: true, evaluator: { kind: "judge" } })
      ]),
      trace: trace(),
      oracleOutcome,
      agentUnderTest: "codex",
      cloneDir: "/clone",
      traceJsonPath: "/run/trace.json",
      judgeEnabled: false
    });

    expect(results[0]).toMatchObject({
      id: "plan_adherence",
      required: true,
      score: 0,
      passed: false,
      status: "disabled",
      reason: "Judge-backed metrics are disabled."
    });
  });
});

function createEval(metrics: readonly MetricSpec[]): EvalDef {
  return {
    id: "task",
    title: "Task",
    rootDir: "/evals/task",
    target: { repo: "fixture", ref: "main", planDest: "docs/plans/task.md" },
    scorer: undefined,
    oracle: { path: "oracle", solutionDest: "." },
    budget: { maxIterations: 10, maxTokens: 1000, wallClockMs: 60000 },
    judge: { agent: "codex", model: "judge-model", rubric: ["completeness"] },
    weights: { tests: 1, judge: 0 },
    metrics,
    plan: { path: "/evals/task/plan.md", kind: "plan", body: "Do the task.", frontmatter: {} }
  };
}
