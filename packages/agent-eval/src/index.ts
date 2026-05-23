export {
  EvalYamlValidationError,
  evalYamlSchema,
  validateEvalYaml,
  type EvalYaml
} from "./schema.js";
export { defaultSourceConfig, loadSourceConfig } from "./source/config.js";
export { openSource } from "./source/open.js";
export { listEvals, loadEval } from "./source/registry.js";
export { aggregateRuns, compareResultCollections, type AggregateStats } from "./aggregate.js";
export { evalCheck, type CheckOptions, type CheckResult } from "./check/check.js";
export { evalInit, type InitOptions, type InitResult } from "./init/init.js";
export { evalLint, type LintIssue, type LintResult } from "./lint/lint.js";
export { listRuns, loadLatestMatrix, loadRunResult } from "./report/load.js";
export { BudgetEnforcer } from "./run/budget.js";
export { CheatFilter } from "./run/cheat.js";
export { cloneTarget, type CloneTargetInput } from "./run/clone.js";
export { resolveDispatch, type DispatchSpec } from "./run/dispatch.js";
export { judgeMetric, judgeRun, type JudgeMetricScore } from "./run/judge.js";
export { executeMetrics, type MetricJudge } from "./run/metrics/metrics.js";
export { runMatrix } from "./run/matrix.js";
export { verifyOracle } from "./run/oracle.js";
export { runEval, EvalFrameworkError } from "./run/run.js";
export { normalizeTrace } from "./run/trace/normalize.js";
export { runScorer, ScorerError, ScorerTimeoutError } from "./run/scorer.js";
export {
  runVitest,
  VitestError,
  VitestTimeoutError,
  type CaseResult
} from "./run/vitest-runner.js";
export {
  evalCheckCommand,
  evalGroup,
  evalInitCommand,
  evalLintCommand,
  evalReportCommand,
  evalRunCommand
} from "./cli/commands.js";
export { renderCheckResultTable, runCheckCli, type CheckCliInput } from "./cli/check.js";
export { runInitCli, type InitCliInput } from "./cli/init.js";
export { renderLintResults, runLintCli, type LintCliInput } from "./cli/lint.js";
export type {
  AggregatedCell,
  Budget,
  CheatReport,
  EvalDef,
  EvalFs,
  EvalMatrixOptions,
  EvalRunOptions,
  EvalRunResult,
  EvalSource,
  JudgeSpec,
  MetricEvaluatorSpec,
  MetricExecutionStatus,
  MetricId,
  MetricResult,
  ResultComparison,
  ResultComparisonDelta,
  RunTraceSummary,
  MetricSpec,
  PlanKind,
  RubricKey,
  ResolvedScorer,
  ScorerSpec,
  SpawnEvent,
  SpawnUsage,
  SourceConfig,
  Verdict
} from "./types.js";
export type {
  NormalizedTrace,
  NormalizedTraceEvent,
  TraceErrorEvent,
  TraceMessageEvent,
  TraceTimestamp,
  TraceToolEvent,
  TraceToolOperation,
  TraceToolOutcome,
  TraceUsageEvent
} from "./run/trace/types.js";
export { resolveScorer } from "./types.js";
