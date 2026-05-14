import * as fsPromises from "node:fs/promises";
import { parseFrontmatter } from "@poe-code/github-workflows";

const DEFAULT_WORKFLOW_PATH = "./WORKFLOW.md";
const MAESTRO_TASK_STATE_MACHINE_STATES = [
  "queued",
  "agent-running",
  "human-review",
  "done",
  "failed",
  "archived"
];

export type TasksOptionsErrorCode =
  | "invalid_project"
  | "missing_required_states"
  | "missing_workflow";

export class TasksOptionsError extends Error {
  constructor(
    public readonly code: TasksOptionsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TasksOptionsError";
  }
}

export interface TasksCliOptions {
  workflow?: string;
  repo?: string;
  project?: string;
  states?: string;
}

export interface ResolvedTasksOptions {
  owner: string;
  number: number;
  requiredStates: string[];
  repo?: string;
  workflowPath: string;
}

export async function resolveTasksOptions(
  list: string | undefined,
  options: TasksCliOptions
): Promise<ResolvedTasksOptions> {
  const workflowPath = options.workflow ?? DEFAULT_WORKFLOW_PATH;
  const project = parseProject(options.project ?? list);
  const workflowContent = await readWorkflow(workflowPath);
  const { frontmatter } = parseFrontmatter(workflowContent);
  const frontmatterRepo = readTasksRepo(frontmatter);
  const requiredStates = resolveRequiredStates(options.states, frontmatter);
  const repo = resolveRepo(options.repo, frontmatterRepo);

  return {
    owner: project.owner,
    number: project.number,
    requiredStates,
    ...(repo ? { repo } : {}),
    workflowPath
  };
}

async function readWorkflow(workflowPath: string): Promise<string> {
  try {
    return await fsPromises.readFile(workflowPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new TasksOptionsError("missing_workflow", `Workflow file not found: ${workflowPath}`);
    }

    throw error;
  }
}

function parseProject(value: string | undefined): { owner: string; number: number } {
  const [owner, rawNumber, extra] = value?.split("/") ?? [];
  const number = rawNumber === undefined ? NaN : Number(rawNumber);

  if (
    value === undefined ||
    owner === undefined ||
    owner.trim().length === 0 ||
    rawNumber === undefined ||
    rawNumber.trim().length === 0 ||
    extra !== undefined ||
    !Number.isInteger(number)
  ) {
    throw new TasksOptionsError(
      "invalid_project",
      'Expected project to use "<owner>/<number>" format.'
    );
  }

  return {
    owner: owner.trim(),
    number
  };
}

function resolveRequiredStates(
  statesOption: string | undefined,
  frontmatter: Record<string, unknown>
): string[] {
  if (statesOption !== undefined) {
    const states = parseStatesCsv(statesOption);
    if (states.length > 0) {
      return states;
    }

    throw new TasksOptionsError(
      "missing_required_states",
      "Required task states were provided as an empty CSV."
    );
  }

  const maestroStates = readMaestroStates(frontmatter);
  if (maestroStates.length > 0) {
    return maestroStates;
  }

  if (referencesMaestroTaskStateMachine(frontmatter)) {
    return [...MAESTRO_TASK_STATE_MACHINE_STATES];
  }

  throw new TasksOptionsError(
    "missing_required_states",
    "Required task states were not provided and WORKFLOW.md does not define them."
  );
}

function parseStatesCsv(value: string): string[] {
  return value
    .split(",")
    .map((state) => state.trim())
    .filter((state) => state.length > 0);
}

function readMaestroStates(frontmatter: Record<string, unknown>): string[] {
  const maestro = asRecord(frontmatter.maestro);
  if (maestro === undefined) {
    return [];
  }

  return unique([
    ...readStringArray(maestro.active_states),
    ...readStringArray(maestro.terminal_states)
  ]);
}

function readTasksRepo(frontmatter: Record<string, unknown>): string | undefined {
  const tasks = asRecord(frontmatter.tasks);
  return typeof tasks?.repo === "string" && tasks.repo.trim().length > 0
    ? tasks.repo.trim()
    : undefined;
}

function resolveRepo(
  repoOption: string | undefined,
  frontmatterRepo: string | undefined
): string | undefined {
  const trimmedRepoOption = repoOption?.trim();
  return trimmedRepoOption && trimmedRepoOption.length > 0 ? trimmedRepoOption : frontmatterRepo;
}

function referencesMaestroTaskStateMachine(value: unknown): boolean {
  if (value === "maestroTaskStateMachine") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => referencesMaestroTaskStateMachine(item));
  }

  const record = asRecord(value);
  return record === undefined
    ? false
    : Object.values(record).some((item) => referencesMaestroTaskStateMachine(item));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) =>
    typeof item === "string" && item.trim().length > 0 ? [item.trim()] : []
  );
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
