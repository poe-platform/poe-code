import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { loadResolvedSteps } from "../config/loader.js";
import { lockFile } from "../lock/lock.js";
import { resolvePlanPath } from "../plan/discovery.js";
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
  PipelineRunOptions,
  PipelineRunResult,
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
    rmdir: fsPromises.rmdir
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

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runPipeline requires a runAgent implementation.");
  }

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
      totalDurationMs: 0
    };
  }

  const absolutePlanPath = path.isAbsolute(planPath)
    ? planPath
    : path.resolve(options.cwd, planPath);
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
  const pipelineStartTime = Date.now();

  while (runsCompleted < maxRuns) {
    assertNotAborted(options.signal);
    const release = await lockFile(absolutePlanPath, { fs });
    try {
      const steps = await loadResolvedSteps({
        cwd: options.cwd,
        homeDir: options.homeDir,
        fs
      });
      const content = await fs.readFile(absolutePlanPath, "utf8");
      const plan = parsePlan(content, { availableSteps: steps });
      const totalTasks = plan.tasks.length;
      const selection = selectNextExecution(plan, options.task);

      if (selection.kind === "completed") {
        return {
          stopReason: runsCompleted === 0 ? "nothing_to_run" : "completed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime
        };
      }

      if (selection.kind === "blocked") {
        return {
          stopReason: "failed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
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
      let result: AgentRunResult;
      try {
        result = await runAgent({
          agent: options.agent,
          prompt,
          mode,
          cwd: options.cwd,
          ...(options.model ? { model: options.model } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (error) {
        if (isAbortError(error)) {
          return {
            stopReason: "cancelled",
            planPath,
            runsCompleted,
            totalDurationMs: Date.now() - pipelineStartTime,
            lastTaskId: selection.task.id,
            ...(selection.stepName ? { lastStepName: selection.stepName } : {})
          };
        }
        throw error;
      }

      const taskDurationMs = Date.now() - taskStartTime;
      const success = result.exitCode === 0;

      await writeTaskStatus({
        fs,
        planPath: absolutePlanPath,
        taskId: selection.task.id,
        ...(selection.stepName ? { stepName: selection.stepName } : {}),
        status: success ? "done" : "failed"
      });
      runsCompleted += 1;

      options.onTaskComplete?.({
        ...taskProgress,
        durationMs: taskDurationMs,
        success
      });

      if (!success) {
        return {
          stopReason: "failed",
          planPath,
          runsCompleted,
          totalDurationMs: Date.now() - pipelineStartTime,
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
    totalDurationMs: Date.now() - pipelineStartTime
  };
}
