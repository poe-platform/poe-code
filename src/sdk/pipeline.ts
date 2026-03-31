import {
  runPipeline as runWorkspacePipeline,
  type PipelineRunOptions,
  type PipelineRunResult
} from "@poe-code/pipeline";
import { renderAcpStream } from "@poe-code/agent-spawn";
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
  StepDefinition,
  StepMode,
  TaskProgress,
  PlanSummary
} from "@poe-code/pipeline";
export { resolvePlanDirectory } from "@poe-code/pipeline";
export type { PipelineRunOptions, PipelineRunResult };

export async function runPipeline(
  options: PipelineRunOptions
): Promise<PipelineRunResult> {
  return runWorkspacePipeline({
    ...options,
    runAgent: async (input: Parameters<NonNullable<PipelineRunOptions["runAgent"]>>[0]) => {
      const { events, result } = sdkSpawn(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        logDir: input.logDir,
        model: input.model,
        mode: input.mode
      });
      await renderAcpStream(events);
      return await result;
    }
  });
}
