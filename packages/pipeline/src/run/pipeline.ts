import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { loadResolvedSteps } from "../config/loader.js";
import {
  archivePlan as archivePlanShared,
  ensureSafeRunLogDir,
  makeRunLogFileName
} from "@poe-code/agent-harness-tools";
import { resolveAbsolutePlanPath, resolvePlanPath } from "../plan/discovery.js";
import { parsePlan } from "../plan/parser.js";
import { writeFinalizationStatus, writeSetupCompleted, writeTaskStatus } from "../plan/writer.js";
import { serializePlan } from "../plan/serialize.js";
import { buildExecutionPrompt, resolveFileIncludes, selectNextExecution } from "./runner.js";
import { interpolatePipelineVars } from "../vars/interpolate.js";
import { resolvePipelineVars } from "../vars/resolve.js";
import { validateResolvedPromptVars } from "../vars/validate.js";
import type {
  AgentRunResult,
  PipelineFileStat,
  PipelineFileSystem,
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
import { getAbortUsage } from "./abort-usage.js";
import { setTerminalTabName } from "@poe-code/terminal-name";

type ArchivePlanFs = NonNullable<Parameters<typeof archivePlanShared>[0]["fs"]>;
type ResolvedPipelineRunOptions = PipelineRunOptions & Required<Pick<PipelineRunOptions, "fs" | "plan" | "runAgent">>;

function createDefaultFs(): PipelineFileSystem {
  const fs = {
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
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: fsPromises.rmdir,
    rename: fsPromises.rename,
    unlink: fsPromises.unlink,
    realpath: fsPromises.realpath
  };

  return fs as PipelineFileSystem;
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

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function resolveMode(
  stepName: string | undefined,
  steps: Record<string, { mode?: StepMode }>
): StepMode | undefined {
  if (!stepName) {
    return undefined;
  }
  const step = steps[stepName];
  if (!step) {
    throw new Error(`Missing step definition for "${stepName}".`);
  }
  return step.mode;
}

function planIdFromArchivePath(absolutePlanPath: string): string {
  const stem = path.basename(absolutePlanPath, ".md");
  let index = 0;
  while (index < stem.length && stem.charCodeAt(index) >= 48 && stem.charCodeAt(index) <= 57) {
    index += 1;
  }

  if (index > 0 && stem[index] === "-" && index < stem.length - 1) {
    return stem.slice(index + 1);
  }

  return stem;
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const cwd = options.cwd;
  const homeDir = options.homeDir;
  const configuredPlanDirectory = options.planDirectory;
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runPipeline requires a runAgent implementation.");
  }
  assertNotAborted(options.signal);
  const metrics: PipelineMetrics = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    stepsCompleted: 0
  };

  const planPath = await resolvePlanPath({
    cwd,
    homeDir,
    plan: options.plan,
    planDirectory: configuredPlanDirectory,
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

  const absolutePlanPath = resolveAbsolutePlanPath(planPath, cwd, homeDir);
  const canonicalPlanPath = fs.realpath ? await fs.realpath(absolutePlanPath) : path.resolve(absolutePlanPath);
  const waitStartedAt = Date.now();
  let executionStarted = false;
  try {
    return await serializePlan({
      planPath: canonicalPlanPath,
      kind: "run",
      signal: options.signal,
      onWait: options.onLockWait,
      operation: () => {
        executionStarted = true;
        return runResolvedPipeline({ ...options, fs, plan: planPath, runAgent }, metrics);
      }
    });
  } catch (error) {
    if (executionStarted || !isAbortError(error)) throw error;
    return { stopReason: "cancelled", planPath, runsCompleted: 0, totalDurationMs: Math.max(0, Date.now() - waitStartedAt), metrics };
  }
}

async function runResolvedPipeline(
  options: ResolvedPipelineRunOptions,
  metrics: PipelineMetrics
): Promise<PipelineRunResult> {
  const { fs, cwd, homeDir, runAgent, plan: planPath } = options;
  const absolutePlanPath = resolveAbsolutePlanPath(planPath, cwd, homeDir);
  const runLogDir =
    options.logDir ??
    await ensureSafeRunLogDir({
      planPath: absolutePlanPath,
      runner: "pipeline",
      homeDir,
      fs
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
      result = await runAgent({
        agent: phaseDef.agent ?? options.agent,
        prompt: phasePrompt,
        cwd: options.cwd,
        ...(phaseDef.mode ? { mode: phaseDef.mode } : {}),
        logDir: runLogDir,
        logFileName: makeRunLogFileName(phase),
        ...((phaseDef.model ?? options.model) ? { model: phaseDef.model ?? options.model } : {}),
        ...(phaseDef.skills ? { skills: phaseDef.skills } : {}),
        ...(phaseDef.hooks ? { hooks: phaseDef.hooks } : {}),
        ...(mcp ? { mcpServers: mcp } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      });
    } catch (error) {
      if (isAbortError(error)) {
        const usage = getAbortUsage(error);
        if (usage) {
          metrics.totalInputTokens += usage.inputTokens;
          metrics.totalOutputTokens += usage.outputTokens;
          metrics.totalCachedTokens += usage.cachedTokens ?? 0;
        }
        options.onTaskComplete?.({
          ...phaseProgress,
          durationMs: Date.now() - startTime,
          success: false,
          taskCompleted: false,
          cancelled: true,
          ...(usage ? { usage } : {})
        });
        return { success: false, cancelled: true };
      }
      throw error;
    }
    const durationMs = Date.now() - startTime;
    if (result.usage) {
      metrics.totalInputTokens += result.usage.inputTokens;
      metrics.totalOutputTokens += result.usage.outputTokens;
      metrics.totalCachedTokens += result.usage.cachedTokens ?? 0;
    }
    if (options.signal?.aborted) {
      options.onTaskComplete?.({
        ...phaseProgress,
        durationMs,
        success: false,
        taskCompleted: false,
        cancelled: true,
        ...(result.usage ? { usage: result.usage } : {})
      });
      return { success: false, cancelled: true };
    }
    const success = result.exitCode === 0;
    if (success) metrics.stepsCompleted += 1;
    options.onTaskComplete?.({
      ...phaseProgress,
      durationMs,
      success,
      ...(result.usage ? { usage: result.usage } : {})
    });
    return { success, cancelled: false };
  }

  const initialContent = await fs.readFile(absolutePlanPath, "utf8");
  const { plan: initialPlan, stepsConfig: initialStepsConfig } =
    await readResolvedPlanFromContent(initialContent);
  await setTerminalTabName(initialPlan.name?.trim() || path.basename(absolutePlanPath, path.extname(absolutePlanPath)));
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
    fs.readFile.bind(fs),
    { deferFileIncludes: true }
  );
  validateResolvedPromptVars({
    plan: initialPlan,
    steps: initialStepsConfig.steps,
    planPath,
    vars: initialVars,
    ...(resolvedSetup ? { setup: resolvedSetup } : {}),
    ...(initialResolvedTeardown ? { teardown: initialResolvedTeardown } : {})
  });

  const initialSelectionComplete = selectNextExecution(initialPlan, options.task).kind === "completed";
  const initialFinalizationPending = initialPlan.tasks.every((task) => isTaskDone(task.status)) &&
    (initialPlan.finalization === "pending" || initialPlan.finalization === "teardown_completed");
  if (initialSelectionComplete && !initialFinalizationPending) {
    return {
      stopReason: "nothing_to_run",
      planPath,
      runsCompleted: 0,
      totalDurationMs: Date.now() - pipelineStartTime,
      metrics
    };
  }

  if (resolvedSetup && !initialSelectionComplete && !initialPlan.setupCompleted) {
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
        lastTaskId: "setup",
        totalDurationMs: Date.now() - pipelineStartTime,
        metrics
      };
    }
    await writeSetupCompleted({ fs, planPath: absolutePlanPath, signal: options.signal });
  }

  while (true) {
    assertNotAborted(options.signal);
    {
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
        fs.readFile.bind(fs),
        { deferFileIncludes: true }
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
        const fullPlanComplete = plan.tasks.every((task) => isTaskDone(task.status));
        const shouldFinalize = fullPlanComplete && (
          runsCompleted > 0 || plan.finalization === "pending" || plan.finalization === "teardown_completed"
        );
        if (shouldFinalize) {
          if (resolvedTeardown && plan.finalization !== "teardown_completed") {
            const { success, cancelled } = await runPhase(
              resolvedTeardown,
              "teardown",
              totalTasks,
              planVars,
              plan.mcp
            );
            if (cancelled || !success) {
              return {
                stopReason: cancelled ? "cancelled" : "failed",
                planPath,
                runsCompleted,
                lastTaskId: "teardown",
                totalDurationMs: Date.now() - pipelineStartTime,
                metrics
              };
            }
          }
          const acknowledged = await writeFinalizationStatus({
            fs,
            planPath: absolutePlanPath,
            status: "teardown_completed",
            signal: options.signal
          });
          if (!acknowledged) {
            lastGoodPlan = undefined;
            lastGoodStepsConfig = undefined;
            continue;
          }
          if (options.archive !== false) {
            const id = planIdFromArchivePath(absolutePlanPath);
            await archivePlanShared({
              cwd,
              homeDir,
              planDirectory: path.dirname(absolutePlanPath),
              id,
              metadataPatch: { finalization: "completed" },
              fs: fs as unknown as ArchivePlanFs
            });
          } else {
            const completed = await writeFinalizationStatus({
              fs,
              planPath: absolutePlanPath,
              status: "completed",
              signal: options.signal
            });
            if (!completed) {
              lastGoodPlan = undefined;
              lastGoodStepsConfig = undefined;
              continue;
            }
          }
        }
        return {
          stopReason: runsCompleted === 0 && !shouldFinalize ? "nothing_to_run" : "completed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
          metrics
        };
      }

      if (!(runsCompleted < maxRuns)) {
        return {
          stopReason: "max_runs",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
          metrics
        };
      }

      const taskIndex = plan.tasks.findIndex((task) => task.id === selection.task.id) + 1;

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
        completedTasks: plan.tasks.filter((task) => isTaskDone(task.status)).length,
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
          cwd: options.cwd,
          ...(mode ? { mode } : {}),
          logDir: runLogDir,
          logFileName: makeRunLogFileName(role),
          ...(model ? { model } : {}),
          ...(stepDef?.skills ? { skills: stepDef.skills } : {}),
          ...(stepDef?.hooks ? { hooks: stepDef.hooks } : {}),
          ...(plan.mcp ? { mcpServers: plan.mcp } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (error) {
        if (isAbortError(error)) {
          const usage = getAbortUsage(error);
          if (usage) {
            metrics.totalInputTokens += usage.inputTokens;
            metrics.totalOutputTokens += usage.outputTokens;
            metrics.totalCachedTokens += usage.cachedTokens ?? 0;
          }
          options.onTaskComplete?.({
            ...taskProgress,
            durationMs: Date.now() - taskStartTime,
            success: false,
            taskCompleted: false,
            cancelled: true,
            ...(usage ? { usage } : {})
          });
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

      if (result.usage) {
        metrics.totalInputTokens += result.usage.inputTokens;
        metrics.totalOutputTokens += result.usage.outputTokens;
        metrics.totalCachedTokens += result.usage.cachedTokens ?? 0;
      }
      if (options.signal?.aborted) {
        options.onTaskComplete?.({
          ...taskProgress,
          durationMs: Date.now() - taskStartTime,
          success: false,
          taskCompleted: false,
          cancelled: true,
          ...(result.usage ? { usage: result.usage } : {})
        });
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

      const taskDurationMs = Date.now() - taskStartTime;
      const success = result.exitCode === 0;
      if (success) metrics.stepsCompleted += 1;
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
        ...(options.signal ? { signal: options.signal } : {}),
        ...(selection.stepName ? { stepName: selection.stepName } : {}),
        status: success ? "done" : "failed",
        finalization: "pending"
      });

      if (lastGoodPlan) {
        lastGoodPlan.finalization = "pending";
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
    }
  }
}
