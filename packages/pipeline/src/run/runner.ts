import path from "node:path";
import type {
  ExecutionSelection,
  PipelinePlan,
  PipelineTask,
  ResolvedStepDefinitions
} from "../types.js";

function selectFromTask(task: PipelineTask): ExecutionSelection {
  if (typeof task.status === "string") {
    return task.status === "done" ? { kind: "completed" } : { kind: "run", task };
  }

  const stepName = Object.entries(task.status).find(([, value]) => value !== "done")?.[0];
  return stepName ? { kind: "run", task, stepName } : { kind: "completed" };
}

export function selectNextExecution(
  plan: PipelinePlan,
  taskId?: string
): ExecutionSelection {
  const tasks = taskId
    ? plan.tasks.filter((task) => task.id === taskId)
    : plan.tasks;

  if (taskId && tasks.length === 0) {
    throw new Error(`Task "${taskId}" was not found in the plan.`);
  }

  for (const task of tasks) {
    const selection = selectFromTask(task);
    if (selection.kind !== "completed") {
      return selection;
    }
  }

  return { kind: "completed" };
}

export function interpolate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

const FILE_INCLUDE_PATTERN = /\{\{file\s+['"]([^'"]+)['"]\s*\}\}/g;

export async function resolveFileIncludes(
  template: string,
  cwd: string,
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>
): Promise<string> {
  const matches = [...template.matchAll(FILE_INCLUDE_PATTERN)];
  if (matches.length === 0) {
    return template;
  }
  let result = template;
  for (const match of matches) {
    const absolutePath = path.resolve(cwd, match[1]);
    const content = await readFile(absolutePath, "utf8");
    result = result.replace(match[0], content);
  }
  return result;
}

export function buildExecutionPrompt(input: {
  selection: Extract<ExecutionSelection, { kind: "run" }>;
  steps: ResolvedStepDefinitions;
  planPath: string;
  vars?: Record<string, string>;
}): string {
  if (!input.selection.stepName) {
    return input.vars && Object.keys(input.vars).length > 0
      ? interpolate(input.selection.task.prompt, input.vars)
      : input.selection.task.prompt;
  }

  const step = input.steps[input.selection.stepName];
  if (!step) {
    throw new Error(`Missing step definition for "${input.selection.stepName}".`);
  }

  return interpolate(step.prompt, {
    ...(input.vars ?? {}),
    id: input.selection.task.id,
    title: input.selection.task.title,
    prompt: input.selection.task.prompt,
    plan_path: input.planPath
  });
}
