export {
  EvalYamlValidationError,
  evalYamlSchema,
  validateEvalYaml,
  type EvalYaml
} from "./schema.js";
export { defaultSourceConfig, loadSourceConfig } from "./source/config.js";
export { openSource } from "./source/open.js";
export { listEvals, loadEval } from "./source/registry.js";
export { aggregateRuns, type AggregateStats } from "./aggregate.js";
export { listRuns, loadLatestMatrix, loadRunResult } from "./report/load.js";
export { BudgetEnforcer } from "./run/budget.js";
export { CheatFilter } from "./run/cheat.js";
export { cloneTarget, type CloneTargetInput } from "./run/clone.js";
export { resolveDispatch, type DispatchSpec } from "./run/dispatch.js";
export { judgeRun } from "./run/judge.js";
export { runMatrix } from "./run/matrix.js";
export { verifyOracle } from "./run/oracle.js";
export { runEval, EvalFrameworkError } from "./run/run.js";
export { runScorer, ScorerError, ScorerTimeoutError } from "./run/scorer.js";
export {
  runVitest,
  VitestError,
  VitestTimeoutError,
  type CaseResult
} from "./run/vitest-runner.js";
export { evalGroup, evalReportCommand, evalRunCommand } from "./cli/commands.js";
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
  PlanKind,
  RubricKey,
  ResolvedScorer,
  ScorerSpec,
  SpawnEvent,
  SpawnUsage,
  SourceConfig,
  Verdict
} from "./types.js";
export { resolveScorer } from "./types.js";
