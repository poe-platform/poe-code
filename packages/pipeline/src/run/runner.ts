import path from "node:path";
import type {
  ExecutionSelection,
  PipelinePlan,
  PipelineTask,
  ResolvedStepDefinitions
} from "../types.js";
import { interpolatePipelineVars } from "../vars/interpolate.js";

function selectFromTask(task: PipelineTask): ExecutionSelection {
  if (typeof task.status === "string") {
    return task.status === "done" ? { kind: "completed" } : { kind: "run", task };
  }

  const stepName = Object.entries(task.status).find(([, value]) => value !== "done")?.[0];
  return stepName !== undefined ? { kind: "run", task, stepName } : { kind: "completed" };
}

export function selectNextExecution(plan: PipelinePlan, taskId?: string): ExecutionSelection {
  const tasks = taskId ? plan.tasks.filter((task) => task.id === taskId) : plan.tasks;

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

function describeExecutionContext(selection: Extract<ExecutionSelection, { kind: "run" }>): string {
  return selection.stepName
    ? `task "${selection.task.id}" step "${selection.stepName}"`
    : `task "${selection.task.id}"`;
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
  const parts: string[] = [];
  let offset = 0;
  for (const match of matches) {
    const absolutePath = path.resolve(cwd, match[1]);
    const relativePath = path.relative(cwd, absolutePath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Pipeline file include resolves outside the project root: ${match[1]}`);
    }
    const content = await readFile(absolutePath, "utf8");
    parts.push(template.slice(offset, match.index), content);
    offset = match.index + match[0].length;
  }
  parts.push(template.slice(offset));
  return parts.join("");
}

export function buildExecutionPrompt(input: {
  selection: Extract<ExecutionSelection, { kind: "run" }>;
  steps: ResolvedStepDefinitions;
  planPath: string;
  vars?: Record<string, string>;
}): string {
  const context = describeExecutionContext(input.selection);
  const resolvedTaskPrompt = interpolatePipelineVars(
    input.selection.task.prompt,
    input.vars ?? {},
    context
  );

  if (!input.selection.stepName) {
    return resolvedTaskPrompt;
  }

  const step = input.steps[input.selection.stepName];
  if (!step) {
    throw new Error(`Missing step definition for "${input.selection.stepName}".`);
  }

  return interpolatePipelineVars(
    step.prompt,
    {
      ...(input.vars ?? {}),
      id: input.selection.task.id,
      title: input.selection.task.title,
      prompt: resolvedTaskPrompt,
      plan_path: input.planPath
    },
    context
  );
}
