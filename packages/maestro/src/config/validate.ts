import { verifyGhProject, type TaskList, type VerifyGhProjectOptions } from "@poe-code/task-list";
import { SPAWN_MODES } from "@poe-code/agent-spawn/types";
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

export function validateStateDefinitions(
  value: unknown
): asserts value is Record<string, JsonRecord> | Map<string, JsonRecord> {
  if (!isStateMap(value)) {
    throw new Error("Workflow config requires a states map.");
  }

  const entries = Array.from(value instanceof Map ? value.entries() : Object.entries(value));

  if (entries.length === 0) {
    throw new Error("Workflow config requires at least one state.");
  }

  for (const [name, definition] of entries) {
    const stateName = String(name);
    if (stateName.trim().length === 0) {
      throw new Error("State names must not be empty.");
    }

    if (!isRecord(definition)) {
      throw new Error(`State "${stateName}" must be an object.`);
    }

    validateStateDefinition(stateName, definition);
  }
}

export async function validateDispatch(
  cfg: ResolvedConfig,
  taskList: Pick<TaskList, "lists">
): Promise<DispatchValidationResult> {
  const cfgRecord = cfg as unknown as JsonRecord;
  const tasks = getOwnEntry(cfgRecord, "tasks");
  if (tasks === undefined || hasEmptyStringValue(tasks) || hasMissingTaskField(tasks)) {
    return { ok: false, code: "missing_tasks_config" };
  }
  const tasksConfig = tasks as ResolvedConfig["tasks"];
  const tasksRecord = tasksConfig as unknown as JsonRecord;

  if (cfg.activeStateNames.length === 0) {
    return { ok: false, code: "no_active_states" };
  }

  if (cfg.terminalStateNames.length === 0) {
    return { ok: false, code: "no_terminal_states" };
  }

  const initialState = cfg.stateOrder[0];

  if (
    initialState === undefined ||
    !hasOwnState(cfg.states, initialState) ||
    cfg.states[initialState] === undefined
  ) {
    return { ok: false, code: "unknown_initial_state", state: initialState ?? "" };
  }

  const agent = getOwnEntry(cfgRecord, "agent");
  const list = isRecord(agent) ? getOwnEntry(agent, "list") : undefined;

  if (typeof list !== "string") {
    return { ok: false, code: "list_not_found", list: "" };
  }

  const lists = await readLists(taskList);

  if (lists === undefined) {
    return { ok: false, code: "tasks_unreachable" };
  }

  if (!lists.includes(list)) {
    return { ok: false, code: "list_not_found", list };
  }

  const taskType = getOwnEntry(tasksRecord, "type");
  const project = getOwnEntry(tasksRecord, "project");
  if (taskType === "gh-issues" && isRecord(project)) {
    const auth = getOwnEntry(tasksRecord, "auth") as VerifyGhProjectOptions["auth"] | undefined;
    const fetch = getOwnEntry(tasksRecord, "fetch") as VerifyGhProjectOptions["fetch"] | undefined;
    const report = await verifyGhProject({
      owner: getOwnEntry(project, "owner") as string,
      number: getOwnEntry(project, "number") as number,
      requiredStates: unique([...cfg.activeStateNames, ...cfg.terminalStateNames]),
      ...(auth ? { auth } : {}),
      ...(fetch ? { fetch } : {})
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
  const prompt = getOwnEntry(definition, "prompt");
  const terminal = getOwnEntry(definition, "terminal");
  const agent = getOwnEntry(definition, "agent");
  const model = getOwnEntry(definition, "model");
  const mode = getOwnEntry(definition, "mode");
  const hasPrompt = prompt !== undefined;
  const isTerminal = terminal === true;

  if (hasPrompt && isTerminal) {
    throw new Error(`State "${name}" must define exactly one of prompt or terminal: true.`);
  }

  if (prompt !== undefined && typeof prompt !== "string") {
    throw new Error(`State "${name}" prompt must be a string.`);
  }

  if (typeof prompt === "string" && prompt.trim().length === 0) {
    throw new Error(`State "${name}" prompt must not be empty.`);
  }

  if (terminal !== undefined && typeof terminal !== "boolean") {
    throw new Error(`State "${name}" terminal must be a boolean.`);
  }

  if (agent !== undefined && typeof agent !== "string") {
    throw new Error(`State "${name}" agent must be a string.`);
  }

  if (model !== undefined && typeof model !== "string") {
    throw new Error(`State "${name}" model must be a string.`);
  }

  if (mode !== undefined && !isStateMode(mode)) {
    throw new Error(`State "${name}" mode must be "yolo", "auto", "edit", or "read".`);
  }
}

function isStateMap(value: unknown): value is Record<string, JsonRecord> | Map<string, JsonRecord> {
  return isRecord(value) || value instanceof Map;
}

function isStateMode(value: unknown): value is StateMode {
  return typeof value === "string" && SPAWN_MODES.includes(value as StateMode);
}

const taskFieldValidators: Record<string, (value: JsonRecord) => boolean> = {
  "markdown-dir": (value) => isNonEmptyString(getOwnEntry(value, "path")),
  "yaml-file": (value) => isNonEmptyString(getOwnEntry(value, "path")),
  "gh-issues": hasGhIssuesTaskFields
};

function hasMissingTaskField(value: unknown): boolean {
  if (!isRecord(value) || typeof getOwnEntry(value, "type") !== "string") {
    return true;
  }

  return taskFieldValidators[getOwnEntry(value, "type") as string]?.(value) !== true;
}

function hasGhIssuesTaskFields(value: JsonRecord): boolean {
  const project = getOwnEntry(value, "project");
  const state = getOwnEntry(value, "state");
  return (
    isNonEmptyString(getOwnEntry(value, "repo")) &&
    (hasGhIssuesProjectFields(project) || hasGhIssuesStateFields(state))
  );
}

function hasGhIssuesProjectFields(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(getOwnEntry(value, "owner")) &&
    isFiniteNumber(getOwnEntry(value, "number"))
  );
}

function hasGhIssuesStateFields(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(getOwnEntry(value, "labelPrefix"));
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

function hasOwnState(states: Record<string, unknown>, state: string): boolean {
  return Object.prototype.hasOwnProperty.call(states, state);
}

function getOwnEntry(record: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
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
