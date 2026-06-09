import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "@poe-code/github-workflows";
import type { OpenTaskListOptions, StateMachineDef } from "@poe-code/task-list";
import { hasOwnErrorCode } from "../../utils/error-codes.js";

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
  | "missing_tasks_config"
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
  auth?: { token: string };
  workflowPath: string;
}

export interface ResolvedWorkflowTasksOptions {
  taskListOptions: OpenTaskListOptions;
  stateOrder: string[];
  stateMachine: StateMachineDef;
  workflowPath: string;
}

export async function resolveWorkflowTaskListOptions(
  workflowPath: string
): Promise<OpenTaskListOptions> {
  const frontmatter = await readWorkflowFrontmatter(workflowPath);
  return readTaskListOptions(frontmatter, workflowPath);
}

export async function resolveWorkflowMoveTargetOptions(
  workflowPath: string
): Promise<OpenTaskListOptions> {
  const frontmatter = await readWorkflowFrontmatter(workflowPath);
  const taskListOptions = readTaskListOptions(frontmatter, workflowPath);
  const stateOrder = readWorkflowStates(frontmatter);

  if (stateOrder.length === 0) {
    return taskListOptions;
  }

  return {
    ...taskListOptions,
    stateMachine: createAnyToAnyStateMachine(stateOrder)
  } as OpenTaskListOptions;
}

export async function resolveTasksOptions(
  list: string | undefined,
  options: TasksCliOptions
): Promise<ResolvedTasksOptions> {
  const workflowPath = options.workflow ?? DEFAULT_WORKFLOW_PATH;
  const project = parseProject(options.project ?? list);
  const frontmatter = await readWorkflowFrontmatter(workflowPath);
  const frontmatterRepo = readTasksRepo(frontmatter);
  const requiredStates = resolveRequiredStates(options.states, frontmatter);
  const repo = resolveRepo(options.repo, frontmatterRepo);
  const authToken = readTasksAuthToken(frontmatter);

  return {
    owner: project.owner,
    number: project.number,
    requiredStates,
    ...(repo ? { repo } : {}),
    ...(authToken !== undefined ? { auth: { token: authToken } } : {}),
    workflowPath
  };
}

export async function resolveWorkflowTasksOptions(
  options: TasksCliOptions
): Promise<ResolvedWorkflowTasksOptions> {
  const workflowPath = options.workflow ?? DEFAULT_WORKFLOW_PATH;
  const frontmatter = await readWorkflowFrontmatter(workflowPath);
  const taskListOptions = readTaskListOptions(frontmatter, workflowPath);
  const stateOrder = resolveRequiredStates(undefined, frontmatter);
  const stateMachine = createAnyToAnyStateMachine(stateOrder);

  return {
    taskListOptions,
    stateOrder,
    stateMachine,
    workflowPath
  };
}

async function readWorkflowFrontmatter(workflowPath: string): Promise<Record<string, unknown>> {
  const workflowContent = await readWorkflow(workflowPath);
  const { frontmatter } = parseFrontmatter(workflowContent);
  return frontmatter;
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

function readTaskListOptions(
  frontmatter: Record<string, unknown>,
  workflowPath: string
): OpenTaskListOptions {
  const tasks = asRecord(frontmatter.tasks);
  if (tasks === undefined) {
    throw new TasksOptionsError(
      "missing_tasks_config",
      "WORKFLOW.md does not define a tasks backend."
    );
  }

  const resolved = resolveStringValues(tasks);
  if (typeof resolved.path === "string") {
    resolved.path = resolveWorkflowRelativePath(resolved.path, workflowPath);
  }

  return resolved as unknown as OpenTaskListOptions;
}

function createAnyToAnyStateMachine(states: string[]): StateMachineDef {
  return {
    initial: states[0],
    states,
    events: Object.fromEntries(states.map((state) => [state, { from: "*", to: state }]))
  };
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

  const workflowStates = readWorkflowStates(frontmatter);
  if (workflowStates.length > 0) {
    return workflowStates;
  }

  if (referencesMaestroTaskStateMachine(frontmatter)) {
    return [...MAESTRO_TASK_STATE_MACHINE_STATES];
  }

  throw new TasksOptionsError(
    "missing_required_states",
    "Required task states were not provided and WORKFLOW.md does not define them."
  );
}

function readWorkflowStates(frontmatter: Record<string, unknown>): string[] {
  const declaredStates = readDeclaredStates(frontmatter.states);
  if (declaredStates.length > 0) {
    return declaredStates;
  }

  const topLevelStates = readLegacyTopLevelStates(frontmatter);
  if (topLevelStates.length > 0) {
    return topLevelStates;
  }

  return readMaestroStates(frontmatter);
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

function readLegacyTopLevelStates(frontmatter: Record<string, unknown>): string[] {
  return unique([
    ...readStringArray(frontmatter.active_states),
    ...readStringArray(frontmatter.terminal_states)
  ]);
}

function readDeclaredStates(value: unknown): string[] {
  const states = asRecord(value);
  return states === undefined ? [] : Object.keys(states);
}

function readTasksRepo(frontmatter: Record<string, unknown>): string | undefined {
  const tasks = asRecord(frontmatter.tasks);
  return typeof tasks?.repo === "string" && tasks.repo.trim().length > 0
    ? tasks.repo.trim()
    : undefined;
}

function readTasksAuthToken(frontmatter: Record<string, unknown>): string | undefined {
  const auth = asRecord(asRecord(frontmatter.tasks)?.auth);
  if (auth === undefined || typeof auth.token !== "string") {
    return undefined;
  }

  const token = resolveStringValue(auth.token).trim();
  return token.length > 0 && !token.startsWith("$") ? token : undefined;
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

function resolveStringValues(value: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      resolved[key] = resolveStringValue(entry);
    } else if (Array.isArray(entry)) {
      resolved[key] = entry.map((item) =>
        typeof item === "string" ? resolveStringValue(item) : item
      );
    } else if (isPlainRecord(entry)) {
      resolved[key] = resolveStringValues(entry);
    } else {
      resolved[key] = entry;
    }
  }

  return resolved;
}

function resolveStringValue(value: string): string {
  const envPrefix = "$";
  if (!value.startsWith(envPrefix) || value.length === envPrefix.length) {
    return value;
  }

  return process.env[value.slice(envPrefix.length)] ?? value;
}

function resolveWorkflowRelativePath(value: string, workflowPath: string): string {
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(workflowPath), value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? (value as Record<string, unknown>) : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
