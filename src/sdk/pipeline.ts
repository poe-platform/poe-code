import {
  runPipeline as runWorkspacePipeline,
  type PipelineRunOptions,
  type PipelineRunResult
} from "@poe-code/pipeline";
import { renderAcpStream, isActivityTimeoutError } from "@poe-code/agent-spawn";
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

const AUTONOMOUS_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TIMEOUT_RETRIES = 3;

export async function runPipeline(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  return runWorkspacePipeline({
    ...options,
    runAgent: async (input: Parameters<NonNullable<PipelineRunOptions["runAgent"]>>[0]) => {
      for (let attempt = 1; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
        try {
          const { events, result } = sdkSpawn(input.agent, {
            prompt: input.prompt,
            cwd: input.cwd,
            logDir: input.logDir,
            model: input.model,
            mode: input.mode,
            activityTimeoutMs: AUTONOMOUS_ACTIVITY_TIMEOUT_MS,
            ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
            ...(input.signal ? { signal: input.signal } : {})
          });
          await renderAcpStream(events);
          return await result;
        } catch (error) {
          if (!isActivityTimeoutError(error) || attempt === MAX_TIMEOUT_RETRIES) {
            throw error;
          }
        }
      }
      throw new Error("Unreachable");
    }
  });
}
