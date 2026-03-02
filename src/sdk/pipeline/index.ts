export { parsePipeline } from "./parse.js";
export { validatePipeline } from "./validate.js";
export { interpolate } from "./interpolate.js";
export { runPipeline, type RunPipelineOptions } from "./run.js";
export type {
  PipelineDefinition,
  PipelineDefaults,
  PipelineStep,
  PipelineStepEntry,
  PipelineParallelGroup,
  PipelineStepResult,
  PipelineResult,
  PipelineSummary
} from "./types.js";
export { isParallelGroup } from "./types.js";

import { runPipeline } from "./run.js";
import type { PipelineDefinition, PipelineResult } from "./types.js";

export const pipeline = {
  async run(
    definition: PipelineDefinition,
    options?: { cwd?: string }
  ): Promise<PipelineResult> {
    return runPipeline(definition, {
      cwd: options?.cwd ?? process.cwd()
    });
  }
};
