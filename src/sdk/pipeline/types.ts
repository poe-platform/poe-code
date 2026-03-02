import type { SpawnMode } from "@poe-code/agent-spawn";

export interface PipelineDefinition {
  name: string;
  description?: string;
  defaults?: PipelineDefaults;
  steps: PipelineStepEntry[];
}

export interface PipelineDefaults {
  agent?: string;
  mode?: SpawnMode;
  model?: string;
}

export type PipelineStepEntry = PipelineStep | PipelineParallelGroup;

export interface PipelineStep {
  name: string;
  agent?: string;
  prompt: string;
  mode?: SpawnMode;
  model?: string;
  args?: string[];
  cwd?: string;
}

export interface PipelineParallelGroup {
  parallel: PipelineStep[];
}

export interface PipelineStepResult {
  output: string;
  exitCode: number;
  duration: number;
}

export interface PipelineResult {
  steps: Record<string, PipelineStepResult>;
  summary: PipelineSummary;
}

export interface PipelineSummary {
  totalSteps: number;
  completedSteps: number;
  totalDuration: number;
  success: boolean;
}

export function isParallelGroup(
  entry: PipelineStepEntry
): entry is PipelineParallelGroup {
  return "parallel" in entry;
}
