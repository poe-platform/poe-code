import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {
  parsePlan,
  resolveAbsolutePlanPath,
  resolvePlanPath,
  runPipeline as runWorkspacePipeline,
  type PipelineMetrics,
  type PipelineFileSystem,
  type PipelineRunOptions,
  type PipelineRunResult
} from "@poe-code/pipeline";
import { buildPipelineInitPrompt } from "../cli/commands/pipeline-init.js";
import pipelineSkillPlan from "../templates/pipeline/SKILL_plan.md";
import { spawn as sdkSpawn } from "./spawn.js";

export type {
  AgentRunUsage,
  AgentRunInput,
  AgentRunResult,
  PipelineConfig,
  PipelineMetrics,
  PipelinePlan,
  PipelineStatus,
  PipelineTask,
  ResolvedStepDefinitions,
  ResolvedStepsConfig,
  StepDefinition,
  StepMode,
  TaskProgress,
  PlanSummary
} from "@poe-code/pipeline";
export { resolvePlanDirectory } from "@poe-code/pipeline";
export type { PipelineRunOptions, PipelineRunResult };

export interface PipelineInitSource {
  absolutePath: string;
  relativePath: string;
  title: string;
}

type PipelineAgentRunner = NonNullable<PipelineRunOptions["runAgent"]>;
type PipelineAgentRunnerInput = Parameters<PipelineAgentRunner>[0];
type PipelineAgentRunnerResult = Awaited<ReturnType<PipelineAgentRunner>>;

export interface PipelineInitRunOptions {
  agent: string;
  model?: string;
  cwd: string;
  homeDir: string;
  fs?: PipelineFileSystem;
  sources: PipelineInitSource[];
  question?: string;
  assumeYes: boolean;
  runAgent?: PipelineRunOptions["runAgent"];
  signal?: AbortSignal;
  onSourceStart?(source: PipelineInitSource, index: number, total: number): void;
  onSourceComplete?(
    source: PipelineInitSource,
    index: number,
    total: number,
    result: PipelineAgentRunnerResult
  ): void;
}

export interface PipelineInitRunResult {
  stopReason: "done" | "failed" | "cancelled";
  sourcesProcessed: number;
  failedSource?: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

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
      };
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: fsPromises.rmdir,
    rename: fsPromises.rename
  };
}

function createEmptyMetrics(): PipelineMetrics {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    stepsCompleted: 0
  };
}

function needsPipelineInit(planContent: string): boolean {
  try {
    return parsePlan(planContent).tasks.length === 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === "Invalid plan YAML: expected a top-level object." ||
      message === 'Invalid plan YAML: expected "tasks" to be an array.'
    ) {
      return true;
    }
    throw error;
  }
}

export async function runPipeline(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent ?? (async (
    input: Parameters<NonNullable<PipelineRunOptions["runAgent"]>>[0]
  ) => {
    return await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      logDir: input.logDir,
      model: input.model,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
  });

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
      metrics: createEmptyMetrics()
    };
  }

  const absolutePlanPath = resolveAbsolutePlanPath(planPath, options.cwd, options.homeDir);
  const planContent = await fs.readFile(absolutePlanPath, "utf8");

  if (needsPipelineInit(planContent)) {
    const initResult = await runPipelineInit({
      agent: options.agent,
      ...(options.model ? { model: options.model } : {}),
      cwd: options.cwd,
      homeDir: options.homeDir,
      fs,
      sources: [
        {
          absolutePath: absolutePlanPath,
          relativePath: planPath,
          title: path.basename(planPath, path.extname(planPath))
        }
      ],
      assumeYes: options.assumeYes ?? false,
      runAgent,
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (initResult.stopReason === "cancelled") {
      return {
        stopReason: "cancelled",
        planPath,
        runsCompleted: 0,
        totalDurationMs: 0,
        metrics: createEmptyMetrics()
      };
    }

    if (initResult.stopReason === "failed") {
      throw new Error(`Pipeline init failed for "${planPath}".`);
    }

    const initializedPlanContent = await fs.readFile(absolutePlanPath, "utf8");
    if (needsPipelineInit(initializedPlanContent)) {
      throw new Error(`Pipeline init did not produce runnable tasks for "${planPath}".`);
    }
  }

  return runWorkspacePipeline({
    ...options,
    fs,
    plan: planPath,
    runAgent
  });
}

export async function runPipelineInit(
  options: PipelineInitRunOptions
): Promise<PipelineInitRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent ?? (async (input: PipelineAgentRunnerInput) => {
    return await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      mode: input.mode,
      ...(input.signal ? { signal: input.signal } : {})
    });
  });

  if (options.signal?.aborted) {
    return {
      stopReason: "cancelled",
      sourcesProcessed: 0
    };
  }

  let sourcesProcessed = 0;
  const totalSources = options.sources.length;

  for (const [sourceIndex, source] of options.sources.entries()) {
    if (options.signal?.aborted) {
      return {
        stopReason: "cancelled",
        sourcesProcessed
      };
    }

    const displayIndex = sourceIndex + 1;

    try {
      options.onSourceStart?.(source, displayIndex, totalSources);

      const sourceDocContent = await fs.readFile(source.absolutePath, "utf8");
      if (options.signal?.aborted) {
        return {
          stopReason: "cancelled",
          sourcesProcessed
        };
      }

      const prompt = buildPipelineInitPrompt({
        question: options.question,
        sourceDocPath: source.relativePath,
        sourceDocContent,
        skillContent: pipelineSkillPlan
      });
      const result = await runAgent({
        agent: options.agent,
        prompt,
        mode: "yolo",
        cwd: options.cwd,
        ...(options.model ? { model: options.model } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      });

      options.onSourceComplete?.(source, displayIndex, totalSources, result);

      if (result.exitCode !== 0) {
        return {
          stopReason: "failed",
          sourcesProcessed,
          failedSource: source.relativePath
        };
      }

      sourcesProcessed += 1;
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        return {
          stopReason: "cancelled",
          sourcesProcessed
        };
      }

      return {
        stopReason: "failed",
        sourcesProcessed,
        failedSource: source.relativePath
      };
    }
  }

  return {
    stopReason: "done",
    sourcesProcessed
  };
}
