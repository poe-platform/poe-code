import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { loadResolvedSteps } from "../config/loader.js";
import { lockFile } from "../lock/lock.js";
import { resolveAbsolutePlanPath, resolvePlanPath } from "../plan/discovery.js";
import { parsePlan } from "../plan/parser.js";
import { writeTaskStatus } from "../plan/writer.js";
import {
  buildExecutionPrompt,
  selectNextExecution
} from "./runner.js";
import type {
  AgentRunResult,
  PipelineFileStat,
  PipelineFileSystem,
  PipelineMetrics,
  PipelinePlan,
  PipelineRunOptions,
  PipelineRunResult,
  ResolvedStepDefinitions,
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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

async function archivePlan(
  fs: PipelineFileSystem,
  absolutePlanPath: string
): Promise<void> {
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

  const absolutePlanPath = resolveAbsolutePlanPath(
    planPath,
    options.cwd,
    options.homeDir
  );
  if (options.onPlanResolved) {
    const content = await fs.readFile(absolutePlanPath, "utf8");
    const plan = parsePlan(content);
    const total = plan.tasks.length;
    const done = plan.tasks.filter((t) => {
      if (typeof t.status === "string") return t.status === "done";
      return Object.values(t.status).every((s) => s === "done");
    }).length;
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
  let lastGoodSteps: ResolvedStepDefinitions | undefined;
  const pipelineStartTime = Date.now();

  while (runsCompleted < maxRuns) {
    assertNotAborted(options.signal);
    const release = await lockFile(absolutePlanPath, { fs });
    try {
      let steps: ResolvedStepDefinitions;
      let plan: PipelinePlan;

      try {
        steps = await loadResolvedSteps({
          cwd: options.cwd,
          homeDir: options.homeDir,
          fs
        });
        const content = await fs.readFile(absolutePlanPath, "utf8");
        plan = parsePlan(content, { availableSteps: steps });
        lastGoodPlan = plan;
        lastGoodSteps = steps;
      } catch (reloadError) {
        if (!lastGoodPlan || !lastGoodSteps) {
          throw reloadError;
        }
        options.onPlanReloadError?.(
          reloadError instanceof Error
            ? reloadError
            : new Error(String(reloadError))
        );
        plan = lastGoodPlan;
        steps = lastGoodSteps;
      }

      const totalTasks = plan.tasks.length;
      const selection = selectNextExecution(plan, options.task);

      if (selection.kind === "completed") {
        if (runsCompleted > 0) {
          await archivePlan(fs, absolutePlanPath);
        }
        return {
          stopReason: runsCompleted === 0 ? "nothing_to_run" : "completed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
          metrics
        };
      }

      if (selection.kind === "blocked") {
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

      const taskProgress = {
        taskId: selection.task.id,
        taskTitle: selection.task.title,
        ...(selection.stepName ? { stepName: selection.stepName } : {}),
        index: runsCompleted + 1,
        total: totalTasks
      };

      options.onTaskStart?.(taskProgress);

      const prompt = buildExecutionPrompt({
        selection,
        steps,
        planPath
      });
      const mode = resolveMode(selection.stepName, steps);

      const taskStartTime = Date.now();
      const stepDef = selection.stepName ? steps[selection.stepName] : undefined;
      const agent = stepDef?.agent ?? options.agent;
      const model = stepDef?.model ?? options.model;

      let result: AgentRunResult;
      try {
        result = await runAgent({
          agent,
          prompt,
          mode,
          cwd: options.cwd,
          ...(model ? { model } : {}),
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
      if (success) {
        if (selection.stepName) {
          metrics.stepsCompleted += 1;
        } else {
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
