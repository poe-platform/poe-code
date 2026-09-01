import * as fsPromises from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import {
  resolveAbsolutePlanPath,
  runPipeline as runWorkspacePipeline,
  type PipelineFileSystem,
  type PipelineRunOptions as WorkspacePipelineRunOptions,
  type PipelineRunResult
} from "@poe-code/pipeline";
import { buildPipelineInitPrompt } from "../cli/commands/pipeline-init.js";
import pipelineSkillPlan from "../templates/pipeline/SKILL_plan.md";
import { spawn as sdkSpawn } from "./spawn.js";
import { runWithOptionalWorktree } from "./worktree.js";
import type { WorktreeExecutionOptions } from "./types.js";

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
  StepHooks,
  StepMode,
  TaskProgress,
  PlanSummary
} from "@poe-code/pipeline";
export { resolvePlanDirectory } from "@poe-code/pipeline";
export type PipelineRunOptions = WorkspacePipelineRunOptions & {
  worktree?: WorktreeExecutionOptions;
};
export type { PipelineRunResult };

export interface PipelineInitSource {
  absolutePath: string;
  relativePath: string;
  title: string;
}

type PipelineAgentRunner = NonNullable<WorkspacePipelineRunOptions["runAgent"]>;
type PipelineAgentRunnerInput = Parameters<PipelineAgentRunner>[0];
type PipelineAgentRunnerResult = Awaited<ReturnType<PipelineAgentRunner>>;

const PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT = 3;

export interface PipelineInitRunOptions {
  agent: string;
  model?: string;
  cwd: string;
  homeDir: string;
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

function isActivityTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "ActivityTimeoutError";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createAbortError(): Error {
  const error = new Error("Pipeline run cancelled");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function planNeedsInit(
  absolutePath: string,
  fs: Pick<PipelineFileSystem, "readFile">
): Promise<boolean> {
  const content = await fs.readFile(absolutePath, "utf8");
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return true;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return true;
  const frontmatter = content.slice(4, end);
  const parsed = parseYaml(frontmatter) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return true;
  const tasks = parsed.tasks;
  return !Array.isArray(tasks) || tasks.length === 0;
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    assertNotAborted(signal);
    try {
      return await fn();
    } catch (error) {
      if (!isActivityTimeoutError(error)) throw error;
      assertNotAborted(signal);
      lastError = error;
    }
  }
  throw lastError;
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineRunResult> {
  if (isWorktreeEnabled(options.worktree)) {
    const wrapped = await runWithOptionalWorktree<PipelineRunResult>({
      cwd: options.cwd,
      selectedAgent: options.agent,
      ...(options.model ? { selectedModel: options.model } : {}),
      worktree: options.worktree,
      signal: options.signal,
      isSuccessful: ({ stopReason }) =>
        stopReason === "completed" || stopReason === "max_runs" || stopReason === "nothing_to_run",
      run: async ({ worktreeCwd }) =>
        await runPipelineDirect({
          ...options,
          cwd: worktreeCwd,
          worktree: false
        })
    });
    return wrapped.value;
  }

  return await runPipelineDirect(options);
}

async function runPipelineDirect(options: PipelineRunOptions): Promise<PipelineRunResult> {
  assertNotAborted(options.signal);
  const userRunAgent =
    options.runAgent ??
    (async (input: PipelineAgentRunnerInput) => {
      return await sdkSpawn.autonomous(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        logDir: input.logDir,
        ...(input.logFileName ? { logFileName: input.logFileName } : {}),
        model: input.model,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.skills ? { skills: input.skills } : {}),
        ...(input.hooks ? { hooks: input.hooks } : {}),
        ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
        ...(input.signal ? { signal: input.signal } : {})
      });
    });

  if (options.plan) {
    const planFs = options.fs ?? fsPromises;
    const planAbsolutePath = resolveAbsolutePlanPath(options.plan, options.cwd, options.homeDir);
    if (await planNeedsInit(planAbsolutePath, planFs)) {
      const sourceDocContent = await planFs.readFile(planAbsolutePath, "utf8");
      const prompt = buildPipelineInitPrompt({
        sourceDocPath: options.plan,
        sourceDocContent,
        skillContent: pipelineSkillPlan
      });
      const initResult = await runWithRetry(
        () =>
          userRunAgent({
            agent: options.agent,
            prompt,
            cwd: options.cwd,
            ...(options.model ? { model: options.model } : {}),
            ...(options.signal ? { signal: options.signal } : {})
          }),
        PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT,
        options.signal
      );
      assertNotAborted(options.signal);
      if (initResult.exitCode !== 0) {
        throw new Error(`Pipeline initialization failed with exit code ${initResult.exitCode}.`);
      }
    }
  }

  const retryRunAgent: PipelineAgentRunner = (input) =>
    runWithRetry(() => userRunAgent(input), PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT, input.signal);

  return runWorkspacePipeline({
    ...options,
    runAgent: retryRunAgent
  });
}

function isWorktreeEnabled(worktree: WorktreeExecutionOptions | undefined): boolean {
  return worktree === true;
}

export async function runPipelineInit(
  options: PipelineInitRunOptions
): Promise<PipelineInitRunResult> {
  const runAgent =
    options.runAgent ??
    (async (input: PipelineAgentRunnerInput) => {
      return await sdkSpawn.autonomous(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        model: input.model,
        ...(input.mode ? { mode: input.mode } : {}),
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

      const sourceDocContent = await fsPromises.readFile(source.absolutePath, "utf8");
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
        cwd: options.cwd,
        ...(options.model ? { model: options.model } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      });

      if (options.signal?.aborted) {
        return {
          stopReason: "cancelled",
          sourcesProcessed
        };
      }

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
