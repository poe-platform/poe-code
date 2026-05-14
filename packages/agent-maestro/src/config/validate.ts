import { verifyGhProject, type TaskList } from "@poe-code/task-list";
import type { ResolvedStepsConfig } from "@poe-code/pipeline";
import type { ResolvedConfig } from "./schema.js";

type JsonRecord = Record<string, unknown>;

export type DispatchPreflightCode =
  | "missing_tasks_config"
  | "missing_steps_config"
  | "no_steps_defined"
  | "list_not_found"
  | "board_not_provisioned";

export type DispatchValidationResult =
  | { ok: true }
  | { ok: false; code: "missing_tasks_config" }
  | { ok: false; code: "missing_steps_config" }
  | { ok: false; code: "no_steps_defined" }
  | { ok: false; code: "list_not_found"; list: string }
  | {
      ok: false;
      code: "board_not_provisioned";
      report: Awaited<ReturnType<typeof verifyGhProject>>;
    };

export async function validateDispatch(
  cfg: ResolvedConfig,
  taskList: Pick<TaskList, "lists">,
  steps: ResolvedStepsConfig | undefined
): Promise<DispatchValidationResult> {
  if (
    cfg.tasks === undefined ||
    hasEmptyStringValue(cfg.tasks) ||
    hasMissingTaskField(cfg.tasks)
  ) {
    return { ok: false, code: "missing_tasks_config" };
  }

  if (steps === undefined) {
    return { ok: false, code: "missing_steps_config" };
  }

  if (Object.keys(steps.steps).length === 0) {
    return { ok: false, code: "no_steps_defined" };
  }

  const list = cfg.agent.list;

  if (list === undefined) {
    return { ok: false, code: "list_not_found", list: "" };
  }

  if (!(await taskList.lists()).includes(list)) {
    return { ok: false, code: "list_not_found", list };
  }

  if (cfg.tasks.type === "gh-issues") {
    const report = await verifyGhProject({
      owner: cfg.tasks.project.owner,
      number: cfg.tasks.project.number,
      requiredStates: unique([...cfg.active_states, ...cfg.terminal_states]),
      ...("auth" in cfg.tasks && cfg.tasks.auth ? { auth: cfg.tasks.auth } : {}),
      ...("fetch" in cfg.tasks && cfg.tasks.fetch ? { fetch: cfg.tasks.fetch } : {})
    });

    if (!report.ok) {
      return { ok: false, code: "board_not_provisioned", report };
    }
  }

  return { ok: true };
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
