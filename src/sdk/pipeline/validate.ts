import {
  isParallelGroup,
  type PipelineDefinition,
  type PipelineStep,
  type PipelineStepEntry
} from "./types.js";

const REFERENCE_PATTERN = /\{\{steps\.([^.}]+)\.(output|exitCode)\}\}/g;

export function validatePipeline(pipeline: PipelineDefinition): void {
  const defaultAgent = pipeline.defaults?.agent;
  const completedSteps = new Set<string>();
  const allStepNames = collectAllStepNames(pipeline.steps);

  for (const entry of pipeline.steps) {
    if (isParallelGroup(entry)) {
      for (const step of entry.parallel) {
        validateStepAgent(step, defaultAgent);
        validateStepReferences(step, completedSteps, allStepNames);
      }
      for (const step of entry.parallel) {
        completedSteps.add(step.name);
      }
    } else {
      validateStepAgent(entry, defaultAgent);
      validateStepReferences(entry, completedSteps, allStepNames);
      completedSteps.add(entry.name);
    }
  }
}

function validateStepAgent(step: PipelineStep, defaultAgent?: string): void {
  if (!step.agent && !defaultAgent) {
    throw new Error(
      `Step "${step.name}" has no agent and no default agent is configured`
    );
  }
}

function validateStepReferences(
  step: PipelineStep,
  completedSteps: Set<string>,
  allStepNames: Set<string>
): void {
  const references = extractReferences(step.prompt);

  for (const ref of references) {
    if (!allStepNames.has(ref)) {
      throw new Error(
        `Step "${step.name}" references unknown step "${ref}"`
      );
    }

    if (!completedSteps.has(ref)) {
      throw new Error(
        `Step "${step.name}" references "${ref}" which has not completed before it`
      );
    }
  }
}

function extractReferences(prompt: string): Set<string> {
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  REFERENCE_PATTERN.lastIndex = 0;
  while ((match = REFERENCE_PATTERN.exec(prompt)) !== null) {
    const name = match[1];
    if (name !== undefined) {
      refs.add(name);
    }
  }
  return refs;
}

function collectAllStepNames(entries: PipelineStepEntry[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (isParallelGroup(entry)) {
      for (const step of entry.parallel) {
        names.add(step.name);
      }
    } else {
      names.add(entry.name);
    }
  }
  return names;
}
