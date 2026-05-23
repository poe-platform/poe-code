import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireFileLock } from "@poe-code/file-lock";
import {
  spawn,
  spawnAutonomous,
  spawnStreaming,
  type AcpEvent,
  type AutonomousResult,
  type SpawnOptions,
  type SpawnResult,
  type StreamingSpawnFn
} from "@poe-code/agent-spawn";
import { createHostRunner, type RunHandle } from "@poe-code/process-runner";
import { openSource } from "../source/open.js";
import { loadEval } from "../source/registry.js";
import type {
  CheatReport,
  EvalDef,
  EvalRunOptions,
  EvalRunResult,
  JudgeSpec,
  JudgeOverrideSpec,
  SpawnEvent,
  Verdict
} from "../types.js";
import { BudgetEnforcer } from "./budget.js";
import { CheatFilter } from "./cheat.js";
import { cloneTarget } from "./clone.js";
import { resolveDispatch, type DispatchSpec } from "./dispatch.js";
import { judgeRun } from "./judge.js";
import { verifyOracle } from "./oracle.js";
import { runScorer } from "./scorer.js";
import { createTraceNormalizer } from "./trace/normalize.js";
import { writeRunArtifacts } from "./result-writer.js";
import type { CaseResult } from "./vitest-runner.js";

type DispatchResult = AutonomousResult | SpawnResult;

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
  const poeCodeCliPath = resolvePoeCodeCliPath();

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
  await mkdir(path.dirname(runDir), { recursive: true });

  const releaseLock = await acquireFileLock(runDir);
  try {
    await mkdir(runDir, { recursive: true });

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
    await mkdir(path.dirname(clonedPlanPath), { recursive: true });
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
      model: opts.model,
      poeCodeCliPath
    });

    const spawnError = await runDispatch(dispatch, {
      cloneDir,
      model: opts.model,
      signal: controller.signal,
      onEvent
    });

    const budgetSnapshot = enforcer.snapshot();
    const cheatReport = filter.report();
    const trace = traceNormalizer.snapshot();
    const testsResult = await runScorer({
      evalDef,
      evalDir: path.join(source.rootDir, opts.evalId),
      cloneDir,
      signal: controller.signal
    });
    const judgeSpec = resolveJudgeSpec(opts.judge, evalDef);
    const judgeResult =
      judgeSpec !== undefined && !cheatReport.cheated && budgetSnapshot.tripped === undefined
        ? await judgeRun({
            evalDef,
            cloneDir,
            trace,
            testsResult,
            spec: judgeSpec,
            agentUnderTest: opts.agent
          })
        : undefined;

    const result = createEvalRunResult({
      opts,
      evalDef,
      runId,
      startedAt,
      budgetSnapshot,
      cheatReport,
      testsResult,
      judgeResult,
      spawnError
    });

    await writeRunArtifacts(runDir, {
      result,
      events,
      trace,
      cheatReport,
      judge: judgeResult,
      planMd,
      evalYaml
    });

    return result;
  } finally {
    await releaseLock();
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

function resolvePoeCodeCliPath(): string {
  return fileURLToPath(new URL("../../../poe-code/dist/cli.js", import.meta.url));
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
    const result =
      dispatch.kind === "agent"
        ? await spawnAutonomous(createAgentStreamSpawn(input.onEvent), {
            service: dispatch.agent ?? "",
            prompt: dispatch.prompt ?? "",
            cwd: input.cloneDir,
            model: input.model,
            mode: "yolo",
            args: [...dispatch.args],
            signal: input.signal
          })
        : await spawnAutonomous(createNodeStreamSpawn(input.onEvent), {
            service: "node",
            prompt: dispatch.prompt ?? "",
            cwd: input.cloneDir,
            model: input.model,
            mode: "yolo",
            args:
              dispatch.script === undefined
                ? [...dispatch.args]
                : [dispatch.script, ...dispatch.args],
            signal: input.signal
          });

    return readSpawnExitError(result);
  } catch (error) {
    return formatUnknownError(error);
  }
}

function createAgentStreamSpawn(
  onEvent: (event: SpawnEvent) => void
): StreamingSpawnFn<SpawnOptions, DispatchResult> {
  const autonomous = (
    spawn as typeof spawn & {
      autonomous?: (service: string, options: SpawnOptions) => Promise<AutonomousResult>;
    }
  ).autonomous;

  if (autonomous !== undefined) {
    return (service, options) => ({
      events: emptyEvents(),
      result: autonomous(service, options)
    });
  }

  return (service, options) => {
    const handle = spawnStreaming({ ...options, agentId: service });
    return {
      events: observeEvents(handle.events, onEvent),
      result: handle.done
    };
  };
}

function createNodeStreamSpawn(
  _onEvent: (event: SpawnEvent) => void
): StreamingSpawnFn<SpawnOptions, DispatchResult> {
  const autonomous = (
    spawn as typeof spawn & {
      autonomous?: (service: string, options: SpawnOptions) => Promise<AutonomousResult>;
    }
  ).autonomous;

  if (autonomous !== undefined) {
    return (service, options) => ({
      events: emptyEvents(),
      result: autonomous(service, options)
    });
  }

  return (_service, options) => ({
    events: emptyEvents(),
    result: runNodeCommand(options)
  });
}

async function runNodeCommand(options: SpawnOptions): Promise<SpawnResult> {
  const [script, ...args] = options.args ?? [];
  if (script === undefined) {
    return {
      stdout: "",
      stderr: "Missing node script.",
      exitCode: 1
    };
  }

  const handle = createHostRunner().exec({
    command: process.execPath,
    args: [script, ...args],
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal
  });
  const stdout = captureStream(handle.stdout);
  const stderr = captureStream(handle.stderr);
  const result = await handle.result;
  await Promise.all([stdout.finished, stderr.finished]);

  return {
    stdout: stdout.output(),
    stderr: stderr.output(),
    exitCode: result.exitCode
  };
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

function captureStream(stream: RunHandle["stdout"]): {
  output(): string;
  finished: Promise<void>;
} {
  if (stream === null) {
    return {
      output: () => "",
      finished: Promise.resolve()
    };
  }

  let output = "";
  stream.setEncoding("utf8");
  const finished = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.once("end", resolve);
    stream.once("error", reject);
  });

  return {
    output: () => output,
    finished
  };
}

function readSpawnExitError(result: DispatchResult): string | undefined {
  if (!isSpawnResult(result) || result.exitCode === 0) {
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
  judgeResult?: EvalRunResult["judge"];
  spawnError?: string;
}): EvalRunResult {
  const verdict = resolveVerdict({
    cheated: input.cheatReport.cheated,
    budgetTripped: input.budgetSnapshot.tripped !== undefined,
    testsResult: input.testsResult,
    spawnErrored: input.spawnError !== undefined
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
      testsResult: input.testsResult,
      weights: input.evalDef.weights,
      judgeResult: input.judgeResult
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
    cheated: input.cheatReport.cheated,
    cheatReport: input.cheatReport,
    ...(input.spawnError === undefined ? {} : { error: input.spawnError })
  };
}

function resolveVerdict(input: {
  cheated: boolean;
  budgetTripped: boolean;
  testsResult: { passed: number; total: number };
  spawnErrored: boolean;
}): Verdict {
  if (input.cheated) {
    return "cheated";
  }
  if (input.budgetTripped) {
    return "budget_exceeded";
  }
  if (
    input.testsResult.total === 0 ||
    (input.testsResult.passed === 0 && input.testsResult.total > 0)
  ) {
    return "fail";
  }
  if (input.spawnErrored) {
    return "error";
  }
  return "pass";
}

function calculateCorrectness(input: {
  cheated: boolean;
  testsResult: { passed: number; total: number };
  weights: EvalDef["weights"];
  judgeResult?: EvalRunResult["judge"];
}): number {
  if (input.cheated) {
    return 0;
  }

  const testScore = calculatePassRate(input.testsResult);
  return (
    testScore * input.weights.tests + ((input.judgeResult?.mean ?? 0) / 5) * input.weights.judge
  );
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

function isSpawnResult(result: DispatchResult): result is SpawnResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "exitCode" in result &&
    typeof (result as { exitCode?: unknown }).exitCode === "number"
  );
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
