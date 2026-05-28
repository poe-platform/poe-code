import type { Task } from "@poe-code/task-list";

const DEFAULT_TASK_PROMPT = "{{ task.qualifiedId }}: {{ task.name }}\n\n{{ task.description }}";
const TEMPLATE_VAR_NAME_PATTERN = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*";
const PLACEHOLDER_PATTERN = new RegExp(
  `\\\\(\\{\\{\\s*${TEMPLATE_VAR_NAME_PATTERN}\\s*\\}\\})|\\{\\{\\s*(${TEMPLATE_VAR_NAME_PATTERN})\\s*\\}\\}`,
  "g"
);

export interface PromptTemplate {
  prompt: string;
}

export function renderTaskPrompt(
  template: string,
  vars: { task: Task; attempt: number | null }
): string {
  return interpolateTaskVars(resolveTaskTemplate(template), vars);
}

export function renderStepPrompt(
  step: PromptTemplate,
  vars: { prompt: string; task: Task; attempt: number | null }
): string {
  return interpolateTaskVars(step.prompt, vars);
}

export function renderPromptTemplate(
  template: string,
  vars: { prompt: string; task: Task; attempt: number | null }
): string {
  return interpolateTaskVars(template, vars);
}

function resolveTaskTemplate(template: string): string {
  return template.length === 0 ? DEFAULT_TASK_PROMPT : template;
}

function interpolateVars(template: string, values: Record<string, string>): string {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (_match, escaped: string | undefined, key: string | undefined) => {
      if (escaped !== undefined) {
        return escaped;
      }

      const name = key as string;
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        return "";
      }

      return values[name] as string;
    }
  );
}

function renderVars(vars: {
  prompt?: string;
  task: Task;
  attempt: number | null;
}): Record<string, string> {
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
  };
}

function interpolateTaskVars(
  template: string,
  vars: { prompt?: string; task: Task; attempt: number | null }
): string {
  const values = renderVars(vars);
  if (template.includes("task.metadata")) {
    values["task.metadata"] = stableJsonStringify(vars.task.metadata);
  }

  return interpolateVars(template, values);
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)])
    );
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
