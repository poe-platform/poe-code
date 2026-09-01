import os from "node:os";
import path from "node:path";
import { SPAWN_MODES, type SpawnMode } from "@poe-code/agent-spawn/types";
import { resolveScope } from "@poe-code/poe-code-config/core";
import type { OpenTaskListOptions } from "@poe-code/task-list";
import { validateStateDefinitions } from "./validate.js";

type JsonRecord = Record<string, unknown>;

export type StateMode = SpawnMode;

export interface StateDefinition {
  prompt?: string;
  agent?: string;
  model?: string;
  mode?: StateMode;
  terminal?: boolean;
}

export interface WorkflowConfig {
  tasks?: OpenTaskListOptions;
  states: Record<string, StateDefinition>;
  activeStateNames: readonly string[];
  terminalStateNames: readonly string[];
  stateOrder: readonly string[];
  polling: { intervalMs: number };
  workspace: { root: string };
  agent: {
    service: string;
    list?: string;
    maxConcurrentAgents: number;
    maxRetryBackoffMs: number;
  };
}

export type ResolvedConfig = WorkflowConfig;

const maestroConfigScope = {
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
      max_retry_backoff_ms: 300_000
    },
    parse: parseRecord,
    doc: "Agent dispatch options."
  }
} as const;

export function resolveConfig(raw: unknown, cwd: string): ResolvedConfig {
  const rawConfig = isRecord(raw) ? raw : {};
  const scoped = resolveScope(maestroConfigScope, rawConfig, process.env);
  const { states, stateOrder } = parseStates(getOwnEntry(rawConfig, "states"));
  const polling = scoped.polling;
  const workspace = scoped.workspace;
  const agent = scoped.agent as JsonRecord;

  if (hasOwn(agent, "max_turns")) {
    throw new Error("agent.max_turns is not supported by agent spawning.");
  }

  return {
    tasks: resolveTasks(getOwnEntry(rawConfig, "tasks"), cwd),
    states,
    activeStateNames: stateOrder.filter((name) => states[name]?.prompt !== undefined),
    terminalStateNames: stateOrder.filter((name) => states[name]?.terminal === true),
    stateOrder,
    polling: {
      intervalMs: readPositiveInteger(
        getOwnEntry(polling, "interval_ms"),
        30_000,
        "polling.interval_ms"
      )
    },
    workspace: {
      root: resolvePathValue(
        readString(getOwnEntry(workspace, "root"), "workspace.root") ??
          path.join(os.tmpdir(), "poe-code-maestro"),
        cwd
      )
    },
    agent: {
      service: readString(getOwnEntry(agent, "service"), "agent.service") ?? "codex",
      list: readString(resolveStringValue(getOwnEntry(agent, "list")), "agent.list"),
      maxConcurrentAgents: readPositiveInteger(
        getOwnEntry(agent, "max_concurrent_agents"),
        1,
        "agent.max_concurrent_agents"
      ),
      maxRetryBackoffMs: readNonNegativeInteger(
        getOwnEntry(agent, "max_retry_backoff_ms"),
        300_000,
        "agent.max_retry_backoff_ms"
      )
    }
  };
}

function parseStates(value: unknown): {
  states: Record<string, StateDefinition>;
  stateOrder: readonly string[];
} {
  validateStateDefinitions(value);

  const states = Object.create(null) as Record<string, StateDefinition>;
  const stateOrder: string[] = [];
  const entries = value instanceof Map ? value.entries() : Object.entries(value);

  for (const [name, rawDefinition] of entries) {
    const stateName = String(name);
    const definition = rawDefinition as JsonRecord;
    Object.defineProperty(states, stateName, {
      configurable: true,
      enumerable: true,
      value: parseStateDefinition(definition),
      writable: true
    });
    stateOrder.push(stateName);
  }

  return { states, stateOrder };
}

function parseStateDefinition(definition: JsonRecord): StateDefinition {
  const state: StateDefinition = {};

  if (hasOwn(definition, "prompt")) {
    state.prompt = readOptionalString(definition.prompt, "prompt");
  }

  if (hasOwn(definition, "agent")) {
    state.agent = readOptionalString(definition.agent, "agent");
  }

  if (hasOwn(definition, "model")) {
    state.model = readOptionalString(definition.model, "model");
  }

  if (hasOwn(definition, "mode")) {
    state.mode = readMode(definition.mode);
  }

  if (hasOwn(definition, "terminal")) {
    state.terminal = readOptionalBoolean(definition.terminal, "terminal");
  }

  return state;
}

function resolveTasks(value: unknown, cwd: string): OpenTaskListOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const resolved = resolveStringValues(value);

  const taskPath = getOwnEntry(resolved, "path");
  if (typeof taskPath === "string") {
    defineRecordEntry(resolved, "path", resolvePathValue(taskPath, cwd));
  }

  return resolved as unknown as OpenTaskListOptions;
}

function parseRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error("Expected an object.");
  }

  return { ...value };
}

function resolveStringValues(value: JsonRecord): JsonRecord {
  const resolved: JsonRecord = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      defineRecordEntry(resolved, key, resolveStringValue(entry));
      continue;
    }

    if (Array.isArray(entry)) {
      defineRecordEntry(
        resolved,
        key,
        entry.map((item) => (typeof item === "string" ? resolveStringValue(item) : item))
      );
      continue;
    }

    defineRecordEntry(resolved, key, isRecord(entry) ? resolveStringValues(entry) : entry);
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
    throw new Error("workspace.root must not resolve to an empty path");
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

function readString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected "${field}" to be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function readNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected "${field}" to be a number.`);
  }

  return value;
}

function readPositiveInteger(value: unknown, fallback: number, field: string): number {
  const numberValue = readNumber(value, fallback, field);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`Expected "${field}" to be a positive integer.`);
  }
  return numberValue;
}

function readNonNegativeInteger(value: unknown, fallback: number, field: string): number {
  const numberValue = readNumber(value, fallback, field);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`Expected "${field}" to be a non-negative integer.`);
  }
  return numberValue;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected state "${field}" to be a string.`);
  }

  return value;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected state "${field}" to be a boolean.`);
  }

  return value;
}

function readMode(value: unknown): StateMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && SPAWN_MODES.includes(value as SpawnMode)) {
    return value as SpawnMode;
  }

  throw new Error('Expected state "mode" to be one of "yolo", "auto", "edit", or "read".');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function getOwnEntry(value: JsonRecord, key: string): unknown {
  return hasOwn(value, key) ? value[key] : undefined;
}

function defineRecordEntry(record: JsonRecord, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
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
