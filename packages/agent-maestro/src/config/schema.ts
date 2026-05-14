import os from "node:os";
import path from "node:path";
import { resolveScope } from "@poe-code/poe-code-config";
import type { StepDefinitionOverrides } from "@poe-code/pipeline";
import type { OpenTaskListOptions } from "@poe-code/task-list";

type JsonRecord = Record<string, unknown>;

export interface ResolvedConfig {
  tasks?: OpenTaskListOptions;
  active_states: string[];
  terminal_states: string[];
  polling: { intervalMs: number };
  workspace: { root: string };
  agent: {
    service: string;
    list?: string;
    maxConcurrentAgents: number;
    maxTurns: number;
    maxRetryBackoffMs: number;
  };
  stepOverrides: StepDefinitionOverrides;
}

const maestroConfigScope = {
  active_states: {
    type: "json",
    default: ["planned", "in-progress"],
    parse: parseStringArray,
    doc: "Task states eligible for dispatch."
  },
  terminal_states: {
    type: "json",
    default: ["done", "archived"],
    parse: parseStringArray,
    doc: "Task states considered terminal by the maestro."
  },
  polling: {
    type: "json",
    default: { interval_ms: 30_000 },
    parse: parseRecord,
    doc: "Polling options."
  },
  workspace: {
    type: "json",
    default: { root: path.join(os.tmpdir(), "poe-code-maestro") },
    parse: parseRecord,
    doc: "Workspace options."
  },
  agent: {
    type: "json",
    default: {
      service: "codex",
      max_concurrent_agents: 1,
      max_turns: 20,
      max_retry_backoff_ms: 300_000
    },
    parse: parseRecord,
    doc: "Agent dispatch options."
  },
  step_overrides: {
    type: "json",
    default: {},
    parse: parseStepOverrides,
    doc: "Pipeline step overrides."
  }
} as const;

export function resolveConfig(raw: unknown, cwd: string): ResolvedConfig {
  const rawConfig = isRecord(raw) ? raw : {};
  const scoped = resolveScope(maestroConfigScope, rawConfig, process.env);
  const polling = scoped.polling;
  const workspace = scoped.workspace;
  const agent = scoped.agent as JsonRecord;

  return {
    tasks: resolveTasks(rawConfig.tasks, cwd),
    active_states: [...scoped.active_states],
    terminal_states: [...scoped.terminal_states],
    polling: {
      intervalMs: readNumber(polling.interval_ms, 30_000)
    },
    workspace: {
      root: resolvePathValue(
        readString(workspace.root) ?? path.join(os.tmpdir(), "poe-code-maestro"),
        cwd
      )
    },
    agent: {
      service: readString(agent.service) ?? "codex",
      list: readString(resolveStringValue(agent.list)),
      maxConcurrentAgents: readNumber(agent.max_concurrent_agents, 1),
      maxTurns: readNumber(agent.max_turns, 20),
      maxRetryBackoffMs: readNumber(agent.max_retry_backoff_ms, 300_000)
    },
    stepOverrides: scoped.step_overrides
  };
}

function resolveTasks(value: unknown, cwd: string): OpenTaskListOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const resolved = resolveStringValues(value);

  if (typeof resolved.path === "string") {
    resolved.path = resolvePathValue(resolved.path, cwd);
  }

  return resolved as unknown as OpenTaskListOptions;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Expected a string array.");
  }

  return [...value];
}

function parseRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error("Expected an object.");
  }

  return { ...value };
}

function parseStepOverrides(value: unknown): StepDefinitionOverrides {
  if (!isRecord(value)) {
    throw new Error("Expected an object.");
  }

  return value as StepDefinitionOverrides;
}

function resolveStringValues(value: JsonRecord): JsonRecord {
  const resolved: JsonRecord = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      resolved[key] = resolveStringValue(entry);
      continue;
    }

    if (Array.isArray(entry)) {
      resolved[key] = entry.map((item) =>
        typeof item === "string" ? resolveStringValue(item) : item
      );
      continue;
    }

    resolved[key] = isRecord(entry) ? resolveStringValues(entry) : entry;
  }

  return resolved;
}

function resolveStringValue(value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("$")) {
    return value;
  }

  const envName = value.slice(1);

  if (!isEnvName(envName)) {
    return value;
  }

  return process.env[envName] ?? "";
}

function resolvePathValue(value: string, cwd: string): string {
  const expanded = expandHome(resolveStringValue(value));

  if (typeof expanded !== "string" || expanded.length === 0) {
    return "";
  }

  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function expandHome(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvName(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isUpper = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;

    if (!isUpper && !isDigit && char !== "_") {
      return false;
    }
  }

  return true;
}
