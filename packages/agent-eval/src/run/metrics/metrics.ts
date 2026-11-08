import type { CaseResult } from "../vitest-runner.js";
import type { EvalDef, MetricResult, MetricSpec } from "../../types.js";
import type { NormalizedTrace, TraceToolEvent } from "../trace/types.js";
import { judgeMetric, type JudgeMetricScore } from "../judge.js";

export type MetricJudge = (input: {
  evalDef: EvalDef;
  metric: MetricSpec;
  cloneDir: string;
  traceJsonPath: string;
  trace: NormalizedTrace;
  oracleOutcome: OracleOutcome;
  agentUnderTest: string;
}) => Promise<JudgeMetricScore>;

type OracleOutcome = { passed: number; total: number; cases: CaseResult[] };

export async function executeMetrics(input: {
  evalDef: EvalDef;
  cloneDir: string;
  traceJsonPath: string;
  trace: NormalizedTrace;
  oracleOutcome: OracleOutcome;
  agentUnderTest: string;
  judgeEnabled?: boolean;
  judgeSkipReason?: string;
  judge?: MetricJudge;
}): Promise<readonly MetricResult[]> {
  const metrics = input.evalDef.metrics ?? [];
  const judge = input.judge ?? judgeMetric;
  const results: MetricResult[] = [];

  for (const metric of metrics) {
    if (!metric.enabled) {
      results.push(createUnavailableResult(metric, "disabled", "Metric is disabled."));
      continue;
    }
    if (metric.evaluator.kind === "judge" && input.judgeEnabled === false) {
      results.push(
        createUnavailableResult(metric, "disabled", "Judge-backed metrics are disabled.")
      );
      continue;
    }
    if (metric.evaluator.kind === "judge" && input.judgeSkipReason !== undefined) {
      results.push(createUnavailableResult(metric, "skipped", input.judgeSkipReason));
      continue;
    }

    try {
      const score =
        metric.evaluator.kind === "judge"
          ? await judge({
              evalDef: input.evalDef,
              metric,
              cloneDir: input.cloneDir,
              traceJsonPath: input.traceJsonPath,
              trace: input.trace,
              oracleOutcome: input.oracleOutcome,
              agentUnderTest: input.agentUnderTest
            })
          : scoreDeterministicMetric(
              metric,
              input.trace,
              input.oracleOutcome,
              input.evalDef.budget.maxIterations
            );
      results.push(createExecutedResult(metric, score));
    } catch (error) {
      results.push(createUnavailableResult(metric, "failed", formatUnknownError(error)));
    }
  }

  return results;
}

function scoreDeterministicMetric(
  metric: MetricSpec,
  trace: NormalizedTrace,
  oracleOutcome: OracleOutcome,
  maxIterations: number
): JudgeMetricScore {
  switch (metric.id) {
    case "task_completion": {
      const score = oracleOutcome.total === 0 ? 0 : oracleOutcome.passed / oracleOutcome.total;
      return {
        score,
        reason: `${oracleOutcome.passed}/${oracleOutcome.total} deterministic oracle tests passed.`
      };
    }
    case "tool_correctness": {
      const completed = terminalToolEvents(trace);
      const successful = completed.filter((event) => event.outcome === "completed").length;
      const score = completed.length === 0 ? 1 : successful / completed.length;
      return {
        score,
        reason:
          completed.length === 0
            ? "No completed tool calls required correctness scoring."
            : `${successful}/${completed.length} completed tool calls succeeded.`,
        traceReferences: completed.map((event) => event.sequence)
      };
    }
    case "step_efficiency": {
      const steps = terminalToolEvents(trace);
      const maxSteps = readPositiveNumber(metric.evaluator.config, "max_steps") ?? maxIterations;
      const score = steps.length === 0 ? 1 : Math.min(1, maxSteps / steps.length);
      return {
        score,
        reason: `${steps.length} completed tool steps observed against a ${maxSteps}-step budget.`,
        traceReferences: steps.map((event) => event.sequence)
      };
    }
    case "plan_adherence":
      throw new Error("plan_adherence requires a judge evaluator.");
  }
}

function terminalToolEvents(trace: NormalizedTrace): readonly TraceToolEvent[] {
  return trace.events.filter(
    (event): event is TraceToolEvent => event.type === "tool" && event.phase === "complete"
  );
}

function createExecutedResult(metric: MetricSpec, evaluated: JudgeMetricScore): MetricResult {
  const score = clampScore(evaluated.score);
  return {
    id: metric.id,
    enabled: metric.enabled,
    required: metric.required,
    weight: metric.weight,
    score,
    threshold: metric.threshold,
    passed: score >= metric.threshold,
    status: "executed",
    reason: evaluated.reason,
    ...(evaluated.traceReferences === undefined
      ? {}
      : { traceReferences: evaluated.traceReferences })
  };
}

function createUnavailableResult(
  metric: MetricSpec,
  status: "disabled" | "failed" | "skipped",
  reason: string
): MetricResult {
  return {
    id: metric.id,
    enabled: metric.enabled,
    required: metric.required,
    weight: metric.weight,
    score: 0,
    threshold: metric.threshold,
    passed: false,
    status,
    reason
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function readPositiveNumber(config: unknown, key: string): number | undefined {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return undefined;
  }
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
