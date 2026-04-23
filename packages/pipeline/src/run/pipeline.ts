import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { loadResolvedSteps } from "../config/loader.js";
import { lockWorkflow, makeRunLogFileName, resolveRunLogDir } from "@poe-code/agent-harness-tools";
import { resolveAbsolutePlanPath, resolvePlanPath } from "../plan/discovery.js";
import { parsePlan } from "../plan/parser.js";
import { writeTaskStatus } from "../plan/writer.js";
import { buildExecutionPrompt, resolveFileIncludes, selectNextExecution } from "./runner.js";
import { interpolatePipelineVars } from "../vars/interpolate.js";
import { resolvePipelineVars } from "../vars/resolve.js";
import { validateResolvedPromptVars } from "../vars/validate.js";
import type {
  AgentRunResult,
  PipelineFileStat,
  PipelineFileSystem,
  PipelineLockStatus,
  PipelineMetrics,
  PipelinePlan,
  PipelineRunOptions,
  PipelineRunResult,
  PipelineTask,
  ResolvedStepsConfig,
  StepDefinition,
  StepMode
} from "../types.js";
import { assertNotAborted } from "../utils.js";

function createDefaultFs(): PipelineFileSystem {
  return {
    readFile: fsPromises.readFile as PipelineFileSystem["readFile"],
    writeFile: fsPromises.writeFile as PipelineFileSystem["writeFile"],
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      } satisfies PipelineFileStat;
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: fsPromises.rmdir,
    rename: fsPromises.rename
  };
}

function isTaskDone(status: PipelineTask["status"]): boolean {
  if (typeof status === "string") {
    return status === "done";
  }

  return Object.values(status).every((stepStatus) => stepStatus === "done");
}

function completesTaskOnSuccess(task: PipelineTask, stepName?: string): boolean {
  if (!stepName || typeof task.status === "string") {
    return true;
  }

  return Object.entries(task.status).every(
    ([currentStepName, currentStatus]) => currentStepName === stepName || currentStatus === "done"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatLockWaitMessage(planPath: string): string {
  return `Another pipeline run is holding the lock for ${planPath}. Waiting...`;
}

function formatLockAcquiredMessage(planPath: string): string {
  return `Lock acquired for ${planPath}. Continuing.`;
}

async function acquirePipelineLock(options: {
  absolutePlanPath: string;
  planPath: string;
  fs: PipelineFileSystem;
  signal?: AbortSignal;
  onLockStatusChange?: (status: PipelineLockStatus) => void;
}): Promise<() => Promise<void>> {
  let waitingReported = false;
  const timerId = global.setTimeout(() => {
    waitingReported = true;
    options.onLockStatusChange?.({
      state: "waiting",
      message: formatLockWaitMessage(options.planPath)
    });
  }, 2_000);

  try {
    const release = await lockWorkflow(options.absolutePlanPath, {
      fs: options.fs,
      retries: Number.POSITIVE_INFINITY,
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (waitingReported) {
      options.onLockStatusChange?.({
        state: "acquired",
        message: formatLockAcquiredMessage(options.planPath)
      });
    }

    return release;
  } finally {
    global.clearTimeout(timerId);
  }
}

function resolveMode(
  stepName: string | undefined,
  steps: Record<string, { mode: StepMode }>
): StepMode {
  if (!stepName) {
    return "yolo";
  }
  const step = steps[stepName];
  if (!step) {
    throw new Error(`Missing step definition for "${stepName}".`);
  }
  return step.mode;
}

async function archivePlan(fs: PipelineFileSystem, absolutePlanPath: string): Promise<void> {
  const dir = path.dirname(absolutePlanPath);
  const archiveDir = path.join(dir, "archive");
  const archivePath = path.join(archiveDir, path.basename(absolutePlanPath));
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(absolutePlanPath, archivePath);
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runPipeline requires a runAgent implementation.");
  }
  const metrics: PipelineMetrics = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    stepsCompleted: 0
  };

  const planPath = await resolvePlanPath({
    cwd: options.cwd,
    homeDir: options.homeDir,
    plan: options.plan,
    planDirectory: options.planDirectory,
    assumeYes: options.assumeYes,
    fs,
    selectPlan: options.selectPlan,
    promptForPath: options.promptForPath
  });

  if (!planPath) {
    return {
      stopReason: "cancelled",
      planPath: "",
      runsCompleted: 0,
      totalDurationMs: 0,
      metrics
    };
  }

  const absolutePlanPath = resolveAbsolutePlanPath(planPath, options.cwd, options.homeDir);
  const runLogDir =
    options.logDir ??
    resolveRunLogDir({
      planPath: absolutePlanPath,
      runner: "pipeline",
      homeDir: options.homeDir
    });
  if (options.onPlanResolved) {
    const content = await fs.readFile(absolutePlanPath, "utf8");
    const plan = parsePlan(content);
    const total = plan.tasks.length;
    const done = plan.tasks.filter((t) => isTaskDone(t.status)).length;
    const failed = plan.tasks.filter((t) => {
      if (typeof t.status === "string") return t.status === "failed";
      return Object.values(t.status).some((s) => s === "failed");
    }).length;
    options.onPlanResolved({
      planPath,
      done,
      failed,
      open: total - done - failed,
      total
    });
  }

  const maxRuns = options.maxRuns ?? Number.POSITIVE_INFINITY;
  let runsCompleted = 0;
  let taskIndex = 0;
  let lastSeenTaskId: string | undefined;
  let lastGoodPlan: PipelinePlan | undefined;
  let lastGoodStepsConfig: ResolvedStepsConfig | undefined;
  const pipelineStartTime = Date.now();

  async function readResolvedPlanFromContent(
    content: string
  ): Promise<{ plan: PipelinePlan; stepsConfig: ResolvedStepsConfig }> {
    const draftPlan = parsePlan(content);
    const stepsConfig = await loadResolvedSteps({
      cwd: options.cwd,
      homeDir: options.homeDir,
      fs,
      name: draftPlan.extends,
      stepOverrides: draftPlan.stepOverrides
    });

    return {
      plan: parsePlan(content, { availableSteps: stepsConfig.steps }),
      stepsConfig
    };
  }

  async function runPhase(
    phaseDef: StepDefinition,
    phase: "setup" | "teardown",
    totalTasks: number,
    vars: Record<string, string>,
    mcp?: PipelinePlan["mcp"]
  ): Promise<{ success: boolean; cancelled: boolean }> {
    const phaseProgress = {
      taskId: phase,
      taskTitle: phase === "setup" ? "Setup" : "Teardown",
      taskIndex: phase === "setup" ? 0 : totalTasks + 1,
      totalTasks,
      phase
    };
    options.onTaskStart?.(phaseProgress);
    const startTime = Date.now();
    let result: AgentRunResult;
    try {
      const rawPrompt = interpolatePipelineVars(phaseDef.prompt, vars, phase);
      const phasePrompt = await resolveFileIncludes(rawPrompt, options.cwd, fs.readFile.bind(fs));
      // runAgent is validated non-null at the top of runPipeline; TypeScript cannot narrow across closures
      result = await runAgent!({
        agent: phaseDef.agent ?? options.agent,
        prompt: phasePrompt,
        mode: phaseDef.mode,
        cwd: options.cwd,
        logDir: runLogDir,
        logFileName: makeRunLogFileName(phase),
        ...((phaseDef.model ?? options.model) ? { model: phaseDef.model ?? options.model } : {}),
        ...(mcp ? { mcpServers: mcp } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      });
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, cancelled: true };
      }
      throw error;
    }
    const durationMs = Date.now() - startTime;
    const success = result.exitCode === 0;
    if (result.usage) {
      metrics.totalInputTokens += result.usage.inputTokens;
      metrics.totalOutputTokens += result.usage.outputTokens;
      metrics.totalCachedTokens += result.usage.cachedTokens ?? 0;
    }
    metrics.stepsCompleted += 1;
    options.onTaskComplete?.({
      ...phaseProgress,
      durationMs,
      success,
      ...(result.usage ? { usage: result.usage } : {})
    });
    return { success, cancelled: false };
  }

  const initialContent = await fs.readFile(absolutePlanPath, "utf8");
  const {
    plan: initialPlan,
    stepsConfig: initialStepsConfig
  } = await readResolvedPlanFromContent(initialContent);
  const resolvedSetup =
    initialPlan.setup === null ? undefined : (initialPlan.setup ?? initialStepsConfig.setup);
  const initialResolvedTeardown =
    initialPlan.teardown === null
      ? undefined
      : (initialPlan.teardown ?? initialStepsConfig.teardown);
  const initialTotalTasks = initialPlan.tasks.length;
  const initialVars = await resolvePipelineVars(
    initialPlan.vars ?? {},
    options.cwd,
    fs.readFile.bind(fs)
  );
  validateResolvedPromptVars({
    plan: initialPlan,
    steps: initialStepsConfig.steps,
    planPath,
    vars: initialVars,
    ...(resolvedSetup ? { setup: resolvedSetup } : {}),
    ...(initialResolvedTeardown ? { teardown: initialResolvedTeardown } : {})
  });

  if (resolvedSetup) {
    const { success, cancelled } = await runPhase(
      resolvedSetup,
      "setup",
      initialTotalTasks,
      initialVars,
      initialPlan.mcp
    );
    if (cancelled || !success) {
      return {
        stopReason: cancelled ? "cancelled" : "failed",
        planPath,
        runsCompleted: 0,
        totalDurationMs: Date.now() - pipelineStartTime,
        metrics
      };
    }
  }

  while (runsCompleted < maxRuns) {
    assertNotAborted(options.signal);
    const release = await acquirePipelineLock({
      absolutePlanPath,
      planPath,
      fs,
      ...(options.signal ? { signal: options.signal } : {}),
      onLockStatusChange: options.onLockStatusChange
    });
    try {
      let stepsConfig: ResolvedStepsConfig;
      let plan: PipelinePlan;

      try {
        const content = await fs.readFile(absolutePlanPath, "utf8");
        ({ plan, stepsConfig } = await readResolvedPlanFromContent(content));
        lastGoodPlan = plan;
        lastGoodStepsConfig = stepsConfig;
      } catch (reloadError) {
        if (!lastGoodPlan || !lastGoodStepsConfig) {
          throw reloadError;
        }
        options.onPlanReloadError?.(
          reloadError instanceof Error ? reloadError : new Error(String(reloadError))
        );
        plan = lastGoodPlan;
        stepsConfig = lastGoodStepsConfig;
      }

      const totalTasks = plan.tasks.length;
      const planVars = await resolvePipelineVars(
        plan.vars ?? {},
        options.cwd,
        fs.readFile.bind(fs)
      );
      const resolvedTeardown =
        plan.teardown === null ? undefined : (plan.teardown ?? stepsConfig.teardown);
      validateResolvedPromptVars({
        plan,
        steps: stepsConfig.steps,
        planPath,
        vars: planVars,
        ...(resolvedTeardown ? { teardown: resolvedTeardown } : {})
      });
      const selection = selectNextExecution(plan, options.task);

      if (selection.kind === "completed") {
        if (runsCompleted > 0) {
          await archivePlan(fs, absolutePlanPath);
          if (resolvedTeardown) {
            const { success, cancelled } = await runPhase(
              resolvedTeardown,
              "teardown",
              initialTotalTasks,
              planVars,
              plan.mcp
            );
            if (cancelled || !success) {
              return {
                stopReason: cancelled ? "cancelled" : "failed",
                planPath,
                runsCompleted,
                totalDurationMs: Date.now() - pipelineStartTime,
                metrics
              };
            }
          }
        }
        return {
          stopReason: runsCompleted === 0 ? "nothing_to_run" : "completed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
          metrics
        };
      }

      if (selection.task.id !== lastSeenTaskId) {
        taskIndex += 1;
        lastSeenTaskId = selection.task.id;
      }

      let stepIndex: number | undefined;
      let totalSteps: number | undefined;
      if (selection.stepName && typeof selection.task.status === "object") {
        const stepStatuses = Object.values(selection.task.status);
        totalSteps = stepStatuses.length;
        stepIndex = stepStatuses.filter((s) => s === "done").length + 1;
      }

      const taskProgress = {
        taskId: selection.task.id,
        taskTitle: selection.task.title,
        ...(selection.stepName ? { stepName: selection.stepName } : {}),
        taskIndex,
        totalTasks,
        ...(stepIndex !== undefined ? { stepIndex, totalSteps } : {})
      };

      options.onTaskStart?.(taskProgress);

      const prompt = await resolveFileIncludes(
        buildExecutionPrompt({ selection, steps: stepsConfig.steps, planPath, vars: planVars }),
        options.cwd,
        fs.readFile.bind(fs)
      );
      const mode = resolveMode(selection.stepName, stepsConfig.steps);

      const taskStartTime = Date.now();
      const stepDef = selection.stepName ? stepsConfig.steps[selection.stepName] : undefined;
      const agent = stepDef?.agent ?? options.agent;
      const model = stepDef?.model ?? options.model;

      let result: AgentRunResult;
      try {
        const role = selection.stepName
          ? `${selection.task.id}-${selection.stepName}`
          : selection.task.id;
        result = await runAgent({
          agent,
          prompt,
          mode,
          cwd: options.cwd,
          logDir: runLogDir,
          logFileName: makeRunLogFileName(role),
          ...(model ? { model } : {}),
          ...(plan.mcp ? { mcpServers: plan.mcp } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (error) {
        if (isAbortError(error)) {
          return {
            stopReason: "cancelled",
            planPath,
            runsCompleted,
            totalDurationMs: Date.now() - pipelineStartTime,
            metrics,
            lastTaskId: selection.task.id,
            ...(selection.stepName ? { lastStepName: selection.stepName } : {})
          };
        }
        throw error;
      }

      const taskDurationMs = Date.now() - taskStartTime;
      const success = result.exitCode === 0;
      if (result.usage) {
        metrics.totalInputTokens += result.usage.inputTokens;
        metrics.totalOutputTokens += result.usage.outputTokens;
        metrics.totalCachedTokens += result.usage.cachedTokens ?? 0;
      }
      metrics.stepsCompleted += 1;
      const taskCompleted = success && completesTaskOnSuccess(selection.task, selection.stepName);
      if (success) {
        if (taskCompleted) {
          metrics.tasksCompleted += 1;
        }
      } else {
        metrics.tasksFailed += 1;
      }

      await writeTaskStatus({
        fs,
        planPath: absolutePlanPath,
        taskId: selection.task.id,
        ...(selection.stepName ? { stepName: selection.stepName } : {}),
        status: success ? "done" : "failed"
      });

      if (lastGoodPlan) {
        const cachedTask = lastGoodPlan.tasks.find((t) => t.id === selection.task.id);
        if (cachedTask) {
          const newStatus = success ? "done" : "failed";
          if (selection.stepName && typeof cachedTask.status === "object") {
            cachedTask.status[selection.stepName] = newStatus;
          } else {
            cachedTask.status = newStatus;
          }
        }
      }

      runsCompleted += 1;

      options.onTaskComplete?.({
        ...taskProgress,
        durationMs: taskDurationMs,
        success,
        taskCompleted,
        ...(result.usage ? { usage: result.usage } : {})
      });

      if (!success) {
        return {
          stopReason: "failed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
          metrics,
          lastTaskId: selection.task.id,
          ...(selection.stepName ? { lastStepName: selection.stepName } : {})
        };
      }
    } finally {
      await release();
    }
  }

  return {
    stopReason: "max_runs",
    planPath,
    runsCompleted,
    totalDurationMs: Date.now() - pipelineStartTime,
    metrics
  };
}
