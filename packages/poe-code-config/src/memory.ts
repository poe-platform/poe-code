import type { FileSystem } from "@poe-code/config-mutations";
import { readMergedDocument } from "./store.js";

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
  const cache = getOwnRecordEntry(memory, "cache");
  const mcp = getOwnRecordEntry(memory, "mcp");
  const query = getOwnRecordEntry(memory, "query");

  return {
    root: readString(getOwnEntry(memory, "root")),
    ingestAgent: readString(getOwnEntry(memory, "ingestAgent")),
    ingestTimeoutMs: readNumber(getOwnEntry(memory, "ingestTimeoutMs")) ?? 300_000,
    cacheEnabled: readBoolean(getOwnEntry(cache, "enabled")) ?? true,
    mcpWritesAllowed: readBoolean(getOwnEntry(mcp, "allowWrites")) ?? false,
    defaultQueryBudget: readNumber(getOwnEntry(query, "defaultBudgetTokens")) ?? 4_096
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
