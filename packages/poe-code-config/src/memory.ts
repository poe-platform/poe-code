import type { FileSystem } from "@poe-code/config-mutations";
import { readMergedDocument } from "./store.js";

/** Memory context budget used when memory.query.defaultBudgetTokens is unset. */
export const DEFAULT_QUERY_BUDGET_TOKENS = 4_096;

export interface MemoryConfigOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
}

interface ResolvedMemoryConfig {
  root?: string;
  ingestAgent?: string;
  ingestTimeoutMs: number;
  cacheEnabled: boolean;
  mcpWritesAllowed: boolean;
  defaultQueryBudget: number;
}

export async function configuredMemoryRoot(
  options: MemoryConfigOptions
): Promise<string | undefined> {
  return (await resolveMemoryConfig(options)).root;
}

export async function resolveAgent(
  options: MemoryConfigOptions,
  fallbackAgent: string | null
): Promise<string | null> {
  const memory = await resolveMemoryConfig(options);
  return memory.ingestAgent ?? fallbackAgent;
}

export async function configuredTimeout(options: MemoryConfigOptions): Promise<number> {
  return (await resolveMemoryConfig(options)).ingestTimeoutMs;
}

export async function cacheEnabled(options: MemoryConfigOptions): Promise<boolean> {
  return (await resolveMemoryConfig(options)).cacheEnabled;
}

export async function mcpWritesAllowed(options: MemoryConfigOptions): Promise<boolean> {
  return (await resolveMemoryConfig(options)).mcpWritesAllowed;
}

export async function defaultQueryBudget(options: MemoryConfigOptions): Promise<number> {
  return (await resolveMemoryConfig(options)).defaultQueryBudget;
}

async function resolveMemoryConfig(
  options: MemoryConfigOptions
): Promise<ResolvedMemoryConfig> {
  const document = await readMergedDocument(options.fs, options.filePath, options.projectFilePath);
  const memory = getOwnRecordEntry(document, "memory");
  const cache = readOptionalRecord(getOwnEntry(memory, "cache"), "memory.cache");
  const mcp = readOptionalRecord(getOwnEntry(memory, "mcp"), "memory.mcp");
  const query = readOptionalRecord(getOwnEntry(memory, "query"), "memory.query");
  const ingestTimeoutMs =
    readOptionalNumber(getOwnEntry(memory, "ingestTimeoutMs"), "memory.ingestTimeoutMs") ??
    300_000;
  const defaultQueryBudget =
    readOptionalNumber(getOwnEntry(query, "defaultBudgetTokens"), "memory.query.defaultBudgetTokens") ??
    DEFAULT_QUERY_BUDGET_TOKENS;

  if (ingestTimeoutMs < 0) {
    throw new Error("memory.ingestTimeoutMs: expected a non-negative finite number.");
  }
  if (!Number.isInteger(defaultQueryBudget) || defaultQueryBudget <= 0) {
    throw new Error("memory.query.defaultBudgetTokens: expected a positive integer.");
  }

  return {
    root: readOptionalString(getOwnEntry(memory, "root"), "memory.root"),
    ingestAgent: readOptionalString(getOwnEntry(memory, "ingestAgent"), "memory.ingestAgent"),
    ingestTimeoutMs,
    cacheEnabled: readOptionalBoolean(getOwnEntry(cache, "enabled"), "memory.cache.enabled") ?? true,
    mcpWritesAllowed:
      readOptionalBoolean(getOwnEntry(mcp, "allowWrites"), "memory.mcp.allowWrites") ?? false,
    defaultQueryBudget
  };
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnRecordEntry(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = getOwnEntry(record, key);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readOptionalRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field}: expected a string.`);
  }
  return value;
}

function readOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field}: expected a finite number.`);
  }
  return value;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field}: expected a boolean.`);
  }
  return value;
}
