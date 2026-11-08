import type { Dirent } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import type { AcpEvent } from "@poe-code/agent-spawn";
import type { AggregateStats } from "./aggregate.js";
import type { CaseResult } from "./run/vitest-runner.js";

export type { AggregateStats } from "./aggregate.js";
export type { SpawnUsage } from "@poe-code/agent-spawn";

export type PlanKind = "plan" | "pipeline" | "superintendent" | "experiment";
export type RubricKey = "completeness" | "spec_adherence" | "code_quality" | string;
export type Verdict = "pass" | "fail" | "error" | "cheated" | "budget_exceeded";
export type ScoringComponentStatus = "executed" | "skipped" | "failed" | "disabled";
export type MetricId =
  | "task_completion"
  | "plan_adherence"
  | "tool_correctness"
  | "step_efficiency";
export type MetricExecutionStatus = ScoringComponentStatus;

export type MetricEvaluatorSpec =
  | { kind: "deterministic"; config?: unknown }
  | {
      kind: "judge";
      agent?: string;
      model?: string;
      instructions?: string;
      config?: unknown;
    };

export interface MetricSpec {
  id: MetricId;
  enabled: boolean;
  required: boolean;
  weight: number;
  threshold: number;
  evaluator: MetricEvaluatorSpec;
}

export interface MetricResult {
  id: MetricId;
  enabled: boolean;
  required: boolean;
  weight: number;
  score: number;
  threshold: number;
  passed: boolean;
  status: MetricExecutionStatus;
  reason: string;
  traceReferences?: readonly number[];
}

export interface ScoringComponentResult {
  configured: boolean;
  required: boolean;
  configuredWeight: number;
  effectiveWeight: number;
  status: ScoringComponentStatus;
  reason?: string;
}

export interface EvalScoringResult {
  tests: ScoringComponentResult;
  judge: ScoringComponentResult;
}

export interface EvalSource {
  rootDir: string;
}

export interface EvalFs {
  readdir(
    path: string,
    options?: { withFileTypes?: boolean }
  ): Promise<readonly (string | Dirent)[]>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<Stats | { isDirectory(): boolean; isFile?(): boolean }>;
}

export interface Budget {
  maxIterations: number;
  maxTokens: number;
  wallClockMs: number;
}

export type SpawnEvent = AcpEvent | ({ sessionUpdate: string } & Record<string, unknown>);

export interface JudgeSpec {
  agent: string;
  model: string;
  rubric: readonly RubricKey[];
}

export interface JudgeOverrideSpec {
  agent?: string;
  model?: string;
  rubric?: readonly RubricKey[];
}

export interface ScorerSpec {
  command: string;
  cwd: string;
  resultPath: string;
  timeoutMs: number;
}

export type ResolvedScorer =
  | { kind: "custom"; spec: ScorerSpec }
  | { kind: "vitest"; testsDir: string };

export interface EvalDef {
  id: string;
  title: string;
  rootDir: string;
  target: {
    repo: string;
    ref: string;
    planDest: string;
  };
  scorer: ScorerSpec | undefined;
  oracle: {
    path: string;
    solutionDest: string;
  };
  budget: Budget;
  judge: JudgeSpec;
  weights: {
    tests: number;
    judge: number;
  };
  metrics?: readonly MetricSpec[];
  verify?: {
    command: string;
    timeoutMs: number;
  };
  plan: {
    path: string;
    kind: PlanKind;
    body: string;
    frontmatter: Record<string, unknown>;
  };
}

export function resolveScorer(evalDef: EvalDef): ResolvedScorer {
  if (evalDef.scorer !== undefined) {
    return {
      kind: "custom",
      spec: evalDef.scorer
    };
  }

  return {
    kind: "vitest",
    testsDir: path.resolve(path.join(evalDef.rootDir, evalDef.oracle.path, "tests"))
  };
}

export interface EvalRunOptions {
  sourceDir: string;
  evalId: string;
  agent: string;
  model: string;
  outDir?: string;
  cloneCacheDir?: string | null;
  repeatIndex?: number;
  verifyOracle?: boolean;
  judge?: "on" | "off" | JudgeSpec | JudgeOverrideSpec;
}

export interface CheatReport {
  cheated: boolean;
  violations: readonly {
    path: string;
    toolCall: string;
    reason: "outside-clone";
  }[];
  uninspectable?: readonly {
    toolCall: string;
    operation: "read" | "search" | "exec" | "edit" | "write" | "mcp";
    reason: "shell-command" | "missing-path";
  }[];
}

export interface EvalRunResult {
  runId: string;
  eval: string;
  agent: string;
  model: string;
  planKind: PlanKind;
  verdict: Verdict;
  correctness: number;
  iterations: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    costUsd?: number;
  };
  tests: {
    passed: number;
    total: number;
    pass_rate: number;
    cases: CaseResult[];
  };
  judge?: Record<RubricKey, number> & { mean: number };
  metrics?: readonly MetricResult[];
  scoring: EvalScoringResult;
  cheated: boolean;
  cheatReport: CheatReport;
  trace?: RunTraceSummary;
  error?: string;
}

export interface RunTraceSummary {
  available: boolean;
  eventCount?: number;
  toolEventCount?: number;
  errorEventCount?: number;
}

export interface EvalMatrixOptions {
  sourceDir: string;
  evalIds?: readonly string[];
  agents: readonly string[];
  models: readonly string[];
  repeats?: number;
  outDir?: string;
  cloneCacheDir?: string | null;
  verifyOracle?: boolean;
  judge?: "on" | "off" | JudgeSpec | JudgeOverrideSpec;
}

export interface AggregatedCell {
  cell: {
    eval: string;
    agent: string;
    model: string;
    planKind: PlanKind;
  };
  repeats: number;
  runIds: readonly string[];
  cheated_any: boolean;
  verdicts: Record<Verdict, number>;
  iterations: AggregateStats;
  durationMs: AggregateStats;
  usage: {
    inputTokens: AggregateStats;
    outputTokens: AggregateStats;
    cachedTokens: AggregateStats;
    costUsd: AggregateStats;
  };
  totals?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsd?: number;
  };
  tests: {
    passRateMean: number;
    passRateMin: number;
    passRateMax: number;
  };
  correctness: AggregateStats;
  scoring: {
    tests: ScoringComponentCounts;
    judge: ScoringComponentCounts;
  };
  metrics?: Record<string, AggregatedMetricResult>;
  integrity?: AggregateIntegritySummary;
  judge?: {
    mean: AggregateStats;
  };
}

export interface AggregatedMetricResult {
  score?: AggregateStats;
  passed: number;
  failed: number;
  statuses: ScoringComponentCounts;
}

export interface AggregateIntegritySummary {
  cheatViolations: number;
  uninspectableActions: number;
  tracesAvailable: number;
  executionErrors: number;
}

export type ComparisonDimension =
  | "oracle_correctness"
  | "duration_ms"
  | "tokens"
  | "cost_usd"
  | `metric:${string}`;

export interface ResultComparisonDelta {
  dimension: ComparisonDimension;
  baseline: number;
  current: number;
  delta: number;
  regression: boolean;
}

export interface ResultComparison {
  cell: AggregatedCell["cell"];
  deltas: readonly ResultComparisonDelta[];
  regressions: number;
}

export interface ScoringComponentCounts {
  configured: number;
  executed: number;
  skipped: number;
  failed: number;
  disabled: number;
}

export interface SourceConfig {
  judge: {
    agent: string;
    model: string;
  };
  out: string;
  weights: {
    tests: number;
    judge: number;
  };
  clone_cache_dir: string | null;
}
