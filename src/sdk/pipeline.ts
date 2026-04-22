import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
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
  PipelineLockStatus,
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

async function planNeedsInit(absolutePath: string): Promise<boolean> {
  const content = await fsPromises.readFile(absolutePath, "utf8");
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
  maxAttempts: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isActivityTimeoutError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function runPipeline(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  const userRunAgent = options.runAgent ?? (async (input: PipelineAgentRunnerInput) => {
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

  if (options.plan) {
    const planAbsolutePath = path.resolve(options.cwd, options.plan);
    if (await planNeedsInit(planAbsolutePath)) {
      const sourceDocContent = await fsPromises.readFile(planAbsolutePath, "utf8");
      const prompt = buildPipelineInitPrompt({
        sourceDocPath: options.plan,
        sourceDocContent,
        skillContent: pipelineSkillPlan
      });
      await runWithRetry(
        () => userRunAgent({
          agent: options.agent,
          prompt,
          mode: "yolo",
          cwd: options.cwd,
          ...(options.model ? { model: options.model } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        }),
        PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT
      );
    }
  }

  const retryRunAgent: PipelineAgentRunner = (input) =>
    runWithRetry(() => userRunAgent(input), PIPELINE_ACTIVITY_TIMEOUT_RETRY_COUNT);

  return runWorkspacePipeline({
    ...options,
    runAgent: retryRunAgent
  });
}

export async function runPipelineInit(
  options: PipelineInitRunOptions
): Promise<PipelineInitRunResult> {
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
