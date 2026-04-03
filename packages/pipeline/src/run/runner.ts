import type {
  ExecutionSelection,
  PipelinePlan,
  PipelineTask,
  ResolvedStepDefinitions
} from "../types.js";

function getFailedStepName(status: Record<string, "open" | "done" | "failed">): string | undefined {
  return Object.entries(status).find(([, value]) => value === "failed")?.[0];
}

function getOpenStepName(status: Record<string, "open" | "done" | "failed">): string | undefined {
  return Object.entries(status).find(([, value]) => value === "open")?.[0];
}

function selectFromTask(task: PipelineTask): ExecutionSelection {
  if (typeof task.status === "string") {
    if (task.status === "done") {
      return { kind: "completed" };
    }
    if (task.status === "failed") {
      return { kind: "blocked", task };
    }
    return { kind: "run", task };
  }

  const failedStepName = getFailedStepName(task.status);
  if (failedStepName) {
    return { kind: "blocked", task, stepName: failedStepName };
  }

  const openStepName = getOpenStepName(task.status);
  if (openStepName) {
    return { kind: "run", task, stepName: openStepName };
  }

  return { kind: "completed" };
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

function interpolate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

export function buildExecutionPrompt(input: {
  selection: Extract<ExecutionSelection, { kind: "run" }>;
  steps: ResolvedStepDefinitions;
  planPath: string;
}): string {
  if (!input.selection.stepName) {
    return input.selection.task.prompt;
  }

  const step = input.steps[input.selection.stepName];
  if (!step) {
    throw new Error(`Missing step definition for "${input.selection.stepName}".`);
  }

  return interpolate(step.prompt, {
    id: input.selection.task.id,
    title: input.selection.task.title,
    prompt: input.selection.task.prompt,
    plan_path: input.planPath
  });
}
