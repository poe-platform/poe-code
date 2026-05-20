import { verifyGhProject, type TaskList } from "@poe-code/task-list";
import type { ResolvedConfig, StateMode } from "./schema.js";

type JsonRecord = Record<string, unknown>;

export type DispatchPreflightCode =
  | "missing_tasks_config"
  | "tasks_unreachable"
  | "no_active_states"
  | "no_terminal_states"
  | "unknown_initial_state"
  | "list_not_found"
  | "board_not_provisioned";

export type DispatchValidationResult =
  | { ok: true }
  | { ok: false; code: "missing_tasks_config" }
  | { ok: false; code: "tasks_unreachable" }
  | { ok: false; code: "no_active_states" }
  | { ok: false; code: "no_terminal_states" }
  | { ok: false; code: "unknown_initial_state"; state: string }
  | { ok: false; code: "list_not_found"; list: string }
  | {
      ok: false;
      code: "board_not_provisioned";
      report: Awaited<ReturnType<typeof verifyGhProject>>;
    };

export function validateStateDefinitions(value: unknown): asserts value is
  | Record<string, JsonRecord>
  | Map<string, JsonRecord> {
  if (!isStateMap(value)) {
    throw new Error("Workflow config requires a states map.");
  }

  const entries = Array.from(value instanceof Map ? value.entries() : Object.entries(value));

  if (entries.length === 0) {
    throw new Error("Workflow config requires at least one state.");
  }

  for (const [name, definition] of entries) {
    if (!isRecord(definition)) {
      throw new Error(`State "${String(name)}" must be an object.`);
    }

    validateStateDefinition(String(name), definition);
  }
}

export async function validateDispatch(
  cfg: ResolvedConfig,
  taskList: Pick<TaskList, "lists">
): Promise<DispatchValidationResult> {
  if (
    cfg.tasks === undefined ||
    hasEmptyStringValue(cfg.tasks) ||
    hasMissingTaskField(cfg.tasks)
  ) {
    return { ok: false, code: "missing_tasks_config" };
  }

  if (cfg.activeStateNames.length === 0) {
    return { ok: false, code: "no_active_states" };
  }

  if (cfg.terminalStateNames.length === 0) {
    return { ok: false, code: "no_terminal_states" };
  }

  const initialState = cfg.stateOrder[0];

  if (initialState === undefined || cfg.states[initialState] === undefined) {
    return { ok: false, code: "unknown_initial_state", state: initialState ?? "" };
  }

  const list = cfg.agent.list;

  if (list === undefined) {
    return { ok: false, code: "list_not_found", list: "" };
  }

  const lists = await readLists(taskList);

  if (lists === undefined) {
    return { ok: false, code: "tasks_unreachable" };
  }

  if (!lists.includes(list)) {
    return { ok: false, code: "list_not_found", list };
  }

  if (cfg.tasks.type === "gh-issues") {
    const report = await verifyGhProject({
      owner: cfg.tasks.project.owner,
      number: cfg.tasks.project.number,
      requiredStates: unique([...cfg.activeStateNames, ...cfg.terminalStateNames]),
      ...("auth" in cfg.tasks && cfg.tasks.auth ? { auth: cfg.tasks.auth } : {}),
      ...("fetch" in cfg.tasks && cfg.tasks.fetch ? { fetch: cfg.tasks.fetch } : {})
    });

    if (!report.ok) {
      return { ok: false, code: "board_not_provisioned", report };
    }
  }

  return { ok: true };
}

async function readLists(taskList: Pick<TaskList, "lists">): Promise<string[] | undefined> {
  try {
    return await taskList.lists();
  } catch {
    return undefined;
  }
}

function validateStateDefinition(name: string, definition: JsonRecord): void {
  const hasPrompt = definition.prompt !== undefined;
  const isTerminal = definition.terminal === true;

  if (hasPrompt && isTerminal) {
    throw new Error(`State "${name}" must define exactly one of prompt or terminal: true.`);
  }

  if (definition.prompt !== undefined && typeof definition.prompt !== "string") {
    throw new Error(`State "${name}" prompt must be a string.`);
  }

  if (definition.terminal !== undefined && typeof definition.terminal !== "boolean") {
    throw new Error(`State "${name}" terminal must be a boolean.`);
  }

  if (definition.agent !== undefined && typeof definition.agent !== "string") {
    throw new Error(`State "${name}" agent must be a string.`);
  }

  if (definition.model !== undefined && typeof definition.model !== "string") {
    throw new Error(`State "${name}" model must be a string.`);
  }

  if (definition.mode !== undefined && !isStateMode(definition.mode)) {
    throw new Error(`State "${name}" mode must be "yolo", "edit", or "read".`);
  }
}

function isStateMap(value: unknown): value is Record<string, JsonRecord> | Map<string, JsonRecord> {
  return isRecord(value) || value instanceof Map;
}

function isStateMode(value: unknown): value is StateMode {
  return value === "yolo" || value === "edit" || value === "read";
}

const taskFieldValidators: Record<string, (value: JsonRecord) => boolean> = {
  "markdown-dir": (value) => isNonEmptyString(value.path),
  "yaml-file": (value) => isNonEmptyString(value.path),
  "gh-issues": (value) =>
    isNonEmptyString(value.repo) &&
    isRecord(value.project) &&
    isNonEmptyString(value.project.owner) &&
    isFiniteNumber(value.project.number)
};

function hasMissingTaskField(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return true;
  }

  return taskFieldValidators[value.type]?.(value) !== true;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function hasEmptyStringValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasEmptyStringValue(entry));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).some((entry) => hasEmptyStringValue(entry));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
