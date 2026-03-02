import type { PipelineStepResult } from "./types.js";

export interface InterpolationContext {
  name: string;
  cwd: string;
}

export function interpolate(
  prompt: string,
  completedSteps: Record<string, PipelineStepResult>,
  pipeline: InterpolationContext
): string {
  return prompt.replace(
    /\{\{(steps\.([^.}]+)\.(output|exitCode)|pipeline\.(name|cwd))\}\}/g,
    (_match, _full, stepName, stepField, pipelineField) => {
      if (pipelineField !== undefined) {
        return String(pipeline[pipelineField as keyof InterpolationContext]);
      }

      const stepResult = completedSteps[stepName as string];
      if (!stepResult) {
        return _match;
      }

      return String(stepResult[stepField as keyof PipelineStepResult]);
    }
  );
}
