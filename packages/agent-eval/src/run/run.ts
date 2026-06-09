import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  applyMiddlewares,
  sessionCapture,
  spawnAutonomous,
  spawnStreaming,
  usageCapture,
  type AcpEvent,
  type AcpSpawnContext,
  type SpawnOptions,
  type SpawnResult
} from "@poe-code/agent-spawn";
import { runPipeline, type AgentRunInput as PipelineAgentRunInput } from "@poe-code/pipeline";
import { hasOwnErrorCode } from "../error-codes.js";
import {
  runLoop,
  type AgentRunInput as SuperintendentAgentRunInput
} from "@poe-code/superintendent";
import {
  runExperimentLoop,
  type AgentRunInput as ExperimentAgentRunInput
} from "@poe-code/experiment-loop";
import { openSource } from "../source/open.js";
import { loadEval } from "../source/registry.js";
import { assertCanonicalDestinationPath } from "../path-boundary.js";
import type {
  CheatReport,
  EvalDef,
  EvalRunOptions,
  EvalRunResult,
  EvalScoringResult,
  JudgeSpec,
  JudgeOverrideSpec,
  MetricResult,
  RunTraceSummary,
  SpawnEvent,
  Verdict
} from "../types.js";
import { BudgetEnforcer } from "./budget.js";
import { CheatFilter } from "./cheat.js";
import { cloneTarget } from "./clone.js";
import { resolveDispatch, type DispatchSpec } from "./dispatch.js";
import { ensureRunArtifactDirectory } from "./artifact-path.js";
import { judgeRun } from "./judge.js";
import { executeMetrics } from "./metrics/metrics.js";
import { verifyOracle } from "./oracle.js";
import { runScorer } from "./scorer.js";
import { createTraceNormalizer } from "./trace/normalize.js";
import { writeRunCompletion, writeRunEvidence, writeRunResult } from "./result-writer.js";
import type { CaseResult } from "./vitest-runner.js";

export class EvalFrameworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalFrameworkError";
  }
}

export async function runEval(opts: EvalRunOptions): Promise<EvalRunResult> {
  const startedAt = Date.now();
  const source = await openSource(opts.sourceDir);
  const evalDef = await loadEval(source, opts.evalId);

  if (opts.verifyOracle !== false) {
    const oracleVerification = await verifyOracle(source, opts.evalId);
    if (!oracleVerification.passed) {
      throw new EvalFrameworkError(`Oracle verification failed:\n${oracleVerification.output}`);
    }
  }

  const runId = createRunId({
    evalId: opts.evalId,
    agent: opts.agent,
    model: opts.model,
    repeatIndex: opts.repeatIndex,
    now: new Date()
  });
  const runDir = path.join(opts.outDir ?? "runs", runId);

  {
    await ensureRunArtifactDirectory(source.rootDir, runDir);

    const controller = new AbortController();
    const cloneDir = path.join(runDir, "clone");
    await cloneTarget({
      repo: evalDef.target.repo,
      ref: evalDef.target.ref,
      dest: cloneDir,
      cacheDir: opts.cloneCacheDir,
      signal: controller.signal
    });

    await copyStarterIfPresent(path.join(source.rootDir, opts.evalId, "starter"), cloneDir);

    const sourcePlanPath = path.join(source.rootDir, opts.evalId, "plan.md");
    const sourceEvalYamlPath = path.join(source.rootDir, opts.evalId, "eval.yaml");
    const planMd = await readFile(sourcePlanPath, "utf8");
    const evalYaml = await readFile(sourceEvalYamlPath, "utf8");
    const clonedPlanPath = path.join(cloneDir, evalDef.target.planDest);
    await assertCanonicalDestinationPath(cloneDir, clonedPlanPath, "target.plan_dest");
    await mkdir(path.dirname(clonedPlanPath), { recursive: true });
    await assertCanonicalDestinationPath(cloneDir, clonedPlanPath, "target.plan_dest");
    await cp(sourcePlanPath, clonedPlanPath);

    const events: SpawnEvent[] = [];
    const traceNormalizer = createTraceNormalizer();
    const filter = new CheatFilter({ cloneDir });
    const enforcer = new BudgetEnforcer(evalDef.budget, controller);
    const onEvent = (event: SpawnEvent): void => {
      events.push(event);
      const traceEvent = traceNormalizer.record(event);
      if (traceEvent === undefined) {
        return;
      }
      if (traceEvent.type === "tool") {
        filter.onEvent(traceEvent);
      }
      enforcer.onEvent(traceEvent);
    };

    const dispatch = resolveDispatch({
      planKind: evalDef.plan.kind,
      planBody: evalDef.plan.body,
      planPath: clonedPlanPath,
      agent: opts.agent,
      model: opts.model
    });

    const spawnError = await runDispatch(dispatch, {
      cloneDir,
      model: opts.model,
      signal: controller.signal,
      onEvent
    });

    const budgetSnapshot = enforcer.finalize();
    const cheatReport = filter.report();
    const trace = traceNormalizer.snapshot();
    try {
      await writeRunEvidence(runDir, { events, trace, cheatReport, planMd, evalYaml });
    } catch (error) {
      const result = createEvalRunResult({
        opts,
        evalDef,
        runId,
        startedAt,
        budgetSnapshot,
        cheatReport,
        testsResult: emptyTestsResult(),
        trace: summarizeTrace(trace),
        spawnError,
        evaluationError: `Artifact evidence write failed: ${formatUnknownError(error)}`
      });
      await writeRunResult(runDir, result).catch(() => undefined);
      return result;
    }

    let testsResult = emptyTestsResult();
    let judgeResult: EvalRunResult["judge"] | undefined;
    let metricResults: readonly MetricResult[] | undefined;
    let evaluationError: string | undefined;
    const judgeSpec =
      evalDef.metrics === undefined ? resolveJudgeSpec(opts.judge, evalDef) : undefined;
    let testsStatus: EvalScoringResult["tests"]["status"] = "executed";
    let testsReason: string | undefined;
    let judgeStatus: EvalScoringResult["judge"]["status"] =
      judgeSpec === undefined ? "disabled" : "skipped";
    let judgeReason: string | undefined = judgeSpec === undefined ? "disabled" : undefined;
    try {
      testsResult = await runScorer({
        evalDef,
        evalDir: path.join(source.rootDir, opts.evalId),
        cloneDir
      });
    } catch (error) {
      evaluationError = formatUnknownError(error);
      testsStatus = "failed";
      testsReason = evaluationError;
    }

    if (judgeSpec !== undefined) {
      judgeReason = judgeSkipReason({
        cheated: cheatReport.cheated,
        budgetTripped: budgetSnapshot.tripped !== undefined,
        spawnErrored: spawnError !== undefined,
        testsFailed: testsStatus === "failed"
      });
      if (judgeReason === undefined) {
        try {
          judgeResult = await judgeRun({
            evalDef,
            cloneDir,
            traceJsonPath: path.join(runDir, "trace.json"),
            trace,
            testsResult,
            spec: judgeSpec,
            agentUnderTest: opts.agent
          });
          judgeStatus = "executed";
        } catch (error) {
          evaluationError = formatUnknownError(error);
          judgeStatus = "failed";
          judgeReason = evaluationError;
        }
      }
    }

    if (evalDef.metrics !== undefined) {
      const metricJudgeSkipReason = judgeSkipReason({
        cheated: cheatReport.cheated,
        budgetTripped: budgetSnapshot.tripped !== undefined,
        spawnErrored: spawnError !== undefined,
        testsFailed: testsStatus === "failed"
      });
      metricResults = await executeMetrics({
        evalDef,
        cloneDir,
        traceJsonPath: path.join(runDir, "trace.json"),
        trace,
        oracleOutcome: testsResult,
        agentUnderTest: opts.agent,
        judgeEnabled: opts.judge !== "off",
        ...(metricJudgeSkipReason === undefined ? {} : { judgeSkipReason: metricJudgeSkipReason })
      });
      const unavailableRequiredMetric = metricResults.find(
        (metric) => metric.required && metric.status !== "executed"
      );
      if (unavailableRequiredMetric !== undefined && evaluationError === undefined) {
        evaluationError = `Required metric ${unavailableRequiredMetric.id} could not execute: ${unavailableRequiredMetric.reason}`;
      }
    }

    let result = createEvalRunResult({
      opts,
      evalDef,
      runId,
      startedAt,
      budgetSnapshot,
      cheatReport,
      testsResult,
      trace: summarizeTrace(trace),
      judgeResult,
      metricResults,
      scoring: createScoringResult({
        evalDef,
        testsStatus,
        testsReason,
        judgeStatus,
        judgeReason
      }),
      spawnError,
      evaluationError
    });

    try {
      await writeRunCompletion(runDir, {
        result,
        judge: judgeResult
      });
    } catch (error) {
      result = createEvalRunResult({
        opts,
        evalDef,
        runId,
        startedAt,
        budgetSnapshot,
        cheatReport,
        testsResult,
        trace: summarizeTrace(trace),
        judgeResult,
        metricResults,
        scoring: createScoringResult({
          evalDef,
          testsStatus,
          testsReason,
          judgeStatus,
          judgeReason
        }),
        spawnError,
        evaluationError: `Artifact write failed: ${formatUnknownError(error)}`
      });
      await writeRunResult(runDir, result).catch(() => undefined);
    }

    return result;
  }
}

function createRunId(input: {
  evalId: string;
  agent: string;
  model: string;
  repeatIndex?: number;
  now: Date;
}): string {
  const repeatSuffix = input.repeatIndex === undefined ? "" : `-r${input.repeatIndex}`;
  return `${isoUtcSafe(input.now)}-${input.evalId}-${input.agent}-${input.model.replace(
    /[/]/g,
    "-"
  )}${repeatSuffix}`;
}

function isoUtcSafe(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function copyStarterIfPresent(starterDir: string, cloneDir: string): Promise<void> {
  try {
    const starterStat = await stat(starterDir);
    if (!starterStat.isDirectory()) {
      return;
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }

  await cp(starterDir, cloneDir, {
    recursive: true,
    force: true
  });
}

async function runDispatch(
  dispatch: DispatchSpec,
  input: {
    cloneDir: string;
    model: string;
    signal: AbortSignal;
    onEvent(event: SpawnEvent): void;
  }
): Promise<string | undefined> {
  try {
    switch (dispatch.kind) {
      case "agent":
        return readSpawnExitError(
          await runNestedAgent(
            {
              agent: dispatch.agent,
              prompt: dispatch.prompt,
              cwd: input.cloneDir,
              model: input.model,
              mode: "yolo",
              signal: input.signal
            },
            input.onEvent
          )
        );
      case "pipeline": {
        const result = await runPipeline({
          agent: dispatch.agent,
          model: dispatch.model,
          plan: dispatch.planPath,
          cwd: input.cloneDir,
          homeDir: input.cloneDir,
          assumeYes: true,
          signal: input.signal,
          runAgent: (nestedInput) => runNestedAgent(nestedInput, input.onEvent)
        });
        return result.stopReason === "failed" ? "Pipeline run failed." : undefined;
      }
      case "superintendent":
        await runLoop({
          docPath: dispatch.planPath,
          cwd: input.cloneDir,
          homeDir: input.cloneDir,
          builderAgent: `${dispatch.agent}:${dispatch.model}`,
          signal: input.signal,
          runAgent: (nestedInput) => runNestedAgent(nestedInput, input.onEvent)
        });
        return undefined;
      case "experiment":
        await runExperimentLoop({
          docPath: dispatch.planPath,
          cwd: input.cloneDir,
          homeDir: input.cloneDir,
          agent: `${dispatch.agent}:${dispatch.model}`,
          signal: input.signal,
          runAgent: (nestedInput) => runNestedAgent(nestedInput, input.onEvent)
        });
        return undefined;
    }
  } catch (error) {
    return formatUnknownError(error);
  }
}

type NestedAgentInput =
  | PipelineAgentRunInput
  | SuperintendentAgentRunInput
  | ExperimentAgentRunInput;

async function runNestedAgent(
  input: NestedAgentInput,
  onEvent: (event: SpawnEvent) => void
): Promise<SpawnResult & { sessionResult?: unknown; toolCalls?: unknown[] }> {
  let context: AcpSpawnContext | undefined;
  const model = getOwnProperty(input, "model");
  const signal = getOwnProperty(input, "signal");
  const mode = getOwnProperty(input, "mode");
  const skills = getOwnProperty(input, "skills");
  const mcpServers = getOwnProperty(input, "mcpServers");
  const logDir = getOwnProperty(input, "logDir");
  const logFileName = getOwnProperty(input, "logFileName");
  const logPath = getOwnProperty(input, "logPath");
  const options: SpawnOptions = {
    prompt: input.prompt,
    cwd: input.cwd,
    ...(model ? { model: model as SpawnOptions["model"] } : {}),
    ...(signal ? { signal: signal as AbortSignal } : {}),
    ...(mode ? { mode: mode as SpawnOptions["mode"] } : {}),
    ...(skills ? { skills: skills as SpawnOptions["skills"] } : {}),
    ...(mcpServers ? { mcpServers: mcpServers as SpawnOptions["mcpServers"] } : {}),
    ...(logDir ? { logDir: logDir as SpawnOptions["logDir"] } : {}),
    ...(logFileName ? { logFileName: logFileName as SpawnOptions["logFileName"] } : {}),
    ...(logPath ? { logPath: logPath as SpawnOptions["logPath"] } : {})
  };
  const result = await spawnAutonomous(
    (agent, spawnOptions) => {
      const handle = spawnStreaming({ ...spawnOptions, agentId: agent });
      const attemptContext: AcpSpawnContext = {
        sessionId: "unknown",
        agent,
        events: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        eventStream: observeEvents(handle.events, onEvent),
        prompt: spawnOptions.prompt,
        cwd: spawnOptions.cwd,
        ...(spawnOptions.model ? { model: spawnOptions.model } : {})
      };
      context = attemptContext;
      return {
        events: (async function* () {
          await applyMiddlewares([usageCapture, sessionCapture], attemptContext);
          yield* attemptContext.eventStream ?? emptyEvents();
        })(),
        result: handle.done
      };
    },
    { ...options, service: input.agent }
  );

  return {
    ...result,
    ...(context &&
    (context.usage.inputTokens > 0 ||
      context.usage.outputTokens > 0 ||
      context.usage.cachedTokens !== undefined ||
      context.usage.costUsd !== undefined)
      ? { usage: context.usage }
      : {}),
    ...(context?.sessionResult ? { sessionResult: context.sessionResult } : {}),
    ...(context?.sessionResult?.toolCalls.length
      ? { toolCalls: context.sessionResult.toolCalls }
      : {})
  };
}

function getOwnProperty(value: object, key: PropertyKey): unknown {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<PropertyKey, unknown>)[key]
    : undefined;
}

async function* observeEvents(
  events: AsyncIterable<AcpEvent>,
  onEvent: (event: SpawnEvent) => void
): AsyncIterable<AcpEvent> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

async function* emptyEvents(): AsyncIterable<never> {}

function readSpawnExitError(result: SpawnResult): string | undefined {
  if (result.exitCode === 0) {
    return undefined;
  }

  const detail = result.stderr.trim() || result.stdout.trim();
  return detail.length === 0 ? `Spawn exited with code ${result.exitCode}` : detail;
}

function createEvalRunResult(input: {
  opts: EvalRunOptions;
  evalDef: EvalDef;
  runId: string;
  startedAt: number;
  budgetSnapshot: {
    iterations: number;
    usage: EvalRunResult["usage"];
    elapsedMs: number;
    tripped?: keyof EvalDef["budget"];
  };
  cheatReport: CheatReport;
  testsResult: { passed: number; total: number; cases: CaseResult[] };
  trace?: RunTraceSummary;
  judgeResult?: EvalRunResult["judge"];
  metricResults?: readonly MetricResult[];
  scoring?: EvalScoringResult;
  spawnError?: string;
  evaluationError?: string;
}): EvalRunResult {
  const verdict = resolveVerdict({
    cheated: input.cheatReport.cheated,
    budgetTripped: input.budgetSnapshot.tripped !== undefined,
    testsResult: input.testsResult,
    requiredMetricFailed:
      input.metricResults?.some(
        (metric) => metric.required && metric.status === "executed" && !metric.passed
      ) ?? false,
    spawnErrored: input.spawnError !== undefined,
    evaluationErrored: input.evaluationError !== undefined
  });
  const scoring =
    input.scoring ??
    createScoringResult({
      evalDef: input.evalDef,
      testsStatus: "skipped",
      testsReason: "framework_error",
      judgeStatus:
        resolveJudgeSpec(input.opts.judge, input.evalDef) === undefined ? "disabled" : "skipped",
      judgeReason:
        resolveJudgeSpec(input.opts.judge, input.evalDef) === undefined
          ? "disabled"
          : "framework_error"
    });

  return {
    runId: input.runId,
    eval: input.opts.evalId,
    agent: input.opts.agent,
    model: input.opts.model,
    planKind: input.evalDef.plan.kind,
    verdict,
    correctness: calculateCorrectness({
      cheated: input.cheatReport.cheated,
      testsResult: input.testsResult
    }),
    iterations: input.budgetSnapshot.iterations,
    durationMs: Date.now() - input.startedAt,
    usage: {
      inputTokens: input.budgetSnapshot.usage.inputTokens,
      outputTokens: input.budgetSnapshot.usage.outputTokens,
      ...(input.budgetSnapshot.usage.cachedTokens === undefined
        ? {}
        : { cachedTokens: input.budgetSnapshot.usage.cachedTokens }),
      ...(input.budgetSnapshot.usage.costUsd === undefined
        ? {}
        : { costUsd: input.budgetSnapshot.usage.costUsd })
    },
    tests: {
      ...input.testsResult,
      pass_rate: calculatePassRate(input.testsResult)
    },
    ...(input.judgeResult === undefined ? {} : { judge: input.judgeResult }),
    ...(input.metricResults === undefined ? {} : { metrics: input.metricResults }),
    scoring,
    cheated: input.cheatReport.cheated,
    cheatReport: input.cheatReport,
    ...(input.trace === undefined ? {} : { trace: input.trace }),
    ...(input.evaluationError === undefined && input.spawnError === undefined
      ? {}
      : { error: input.evaluationError ?? input.spawnError })
  };
}

function summarizeTrace(trace: { events: readonly { type: string }[] }): RunTraceSummary {
  return {
    available: true,
    eventCount: trace.events.length,
    toolEventCount: trace.events.filter((event) => event.type === "tool").length,
    errorEventCount: trace.events.filter((event) => event.type === "error").length
  };
}

function resolveVerdict(input: {
  cheated: boolean;
  budgetTripped: boolean;
  testsResult: { passed: number; total: number };
  requiredMetricFailed: boolean;
  spawnErrored: boolean;
  evaluationErrored: boolean;
}): Verdict {
  if (input.cheated) {
    return "cheated";
  }
  if (input.budgetTripped) {
    return "budget_exceeded";
  }
  if (input.evaluationErrored) {
    return "error";
  }
  if (input.spawnErrored) {
    return "error";
  }
  if (input.testsResult.total === 0 || input.testsResult.passed !== input.testsResult.total) {
    return "fail";
  }
  if (input.requiredMetricFailed) {
    return "fail";
  }
  return "pass";
}

function emptyTestsResult(): { passed: number; total: number; cases: CaseResult[] } {
  return { passed: 0, total: 0, cases: [] };
}

function calculateCorrectness(input: {
  cheated: boolean;
  testsResult: { passed: number; total: number };
}): number {
  if (input.cheated) {
    return 0;
  }

  const testScore = calculatePassRate(input.testsResult);
  return testScore;
}

function createScoringResult(input: {
  evalDef: EvalDef;
  testsStatus: EvalScoringResult["tests"]["status"];
  testsReason?: string;
  judgeStatus: EvalScoringResult["judge"]["status"];
  judgeReason?: string;
}): EvalScoringResult {
  const activeWeight =
    input.evalDef.weights.tests +
    (isActiveStatus(input.judgeStatus) ? input.evalDef.weights.judge : 0);
  const effectiveTestWeight = activeWeight === 0 ? 0 : input.evalDef.weights.tests / activeWeight;
  const effectiveJudgeWeight =
    activeWeight === 0 || !isActiveStatus(input.judgeStatus)
      ? 0
      : input.evalDef.weights.judge / activeWeight;

  return {
    tests: {
      configured: true,
      required: true,
      configuredWeight: input.evalDef.weights.tests,
      effectiveWeight: effectiveTestWeight,
      status: input.testsStatus,
      ...(input.testsReason === undefined ? {} : { reason: input.testsReason })
    },
    judge: {
      configured: true,
      required: false,
      configuredWeight: input.evalDef.weights.judge,
      effectiveWeight: effectiveJudgeWeight,
      status: input.judgeStatus,
      ...(input.judgeReason === undefined ? {} : { reason: input.judgeReason })
    }
  };
}

function isActiveStatus(status: EvalScoringResult["judge"]["status"]): boolean {
  return status === "executed" || status === "failed";
}

function judgeSkipReason(input: {
  cheated: boolean;
  budgetTripped: boolean;
  spawnErrored: boolean;
  testsFailed: boolean;
}): string | undefined {
  if (input.cheated) {
    return "cheated";
  }
  if (input.budgetTripped) {
    return "budget_exceeded";
  }
  if (input.spawnErrored) {
    return "execution_error";
  }
  if (input.testsFailed) {
    return "required_component_failed";
  }
  return undefined;
}

function calculatePassRate(testsResult: { passed: number; total: number }): number {
  return testsResult.total === 0 ? 0 : testsResult.passed / testsResult.total;
}

function resolveJudgeSpec(
  option: EvalRunOptions["judge"],
  evalDef: EvalDef
): JudgeSpec | undefined {
  if (option === "off") {
    return undefined;
  }
  if (option === undefined || option === "on") {
    return evalDef.judge;
  }
  return mergeJudgeSpec(evalDef.judge, option);
}

function mergeJudgeSpec(base: JudgeSpec, override: JudgeSpec | JudgeOverrideSpec): JudgeSpec {
  return {
    agent: override.agent ?? base.agent,
    model: override.model ?? base.model,
    rubric: override.rubric ?? base.rubric
  };
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
