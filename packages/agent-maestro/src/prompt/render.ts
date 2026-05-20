import { interpolatePipelineVars, type StepDefinition } from "@poe-code/pipeline";
import type { Task } from "@poe-code/task-list";

const DEFAULT_TASK_PROMPT = "{{ task.qualifiedId }}: {{ task.name }}\n\n{{ task.description }}";

export function renderTaskPrompt(
  template: string,
  vars: { task: Task; attempt: number | null }
): string {
  return interpolatePipelineVars(resolveTaskTemplate(template), renderVars(vars));
}

export function renderStepPrompt(
  step: StepDefinition,
  vars: { prompt: string; task: Task; attempt: number | null }
): string {
  return interpolatePipelineVars(step.prompt, renderVars(vars));
}

function resolveTaskTemplate(template: string): string {
  return template.length === 0 ? DEFAULT_TASK_PROMPT : template;
}

function renderVars(vars: { prompt?: string; task: Task; attempt: number | null }): Record<string, string> {
  return {
    ...(vars.prompt === undefined ? {} : { prompt: vars.prompt }),
    attempt: vars.attempt === null ? "" : String(vars.attempt),
    "task.list": vars.task.list,
    "task.id": vars.task.id,
    "task.qualifiedId": vars.task.qualifiedId,
    "task.name": vars.task.name,
    "task.state": vars.task.state,
    "task.description": vars.task.description,
    "task.url": typeof vars.task.metadata?.url === "string" ? vars.task.metadata.url : "",
    "task.metadata": JSON.stringify(vars.task.metadata)
  };
}
