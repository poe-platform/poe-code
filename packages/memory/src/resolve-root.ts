import path from "node:path";
import type { FileSystem } from "@poe-code/config-mutations";
import { readMergedDocumentReadonly } from "@poe-code/poe-code-config/core";
import { resolveMemoryRoot } from "./paths.js";
import type { MemoryRoot } from "./types.js";

export const MEMORY_ROOT_ENV_VAR = "POE_CODE_MEMORY_ROOT";

export interface ResolveConfiguredMemoryRootOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  fs: FileSystem;
  configPath: string;
  projectConfigPath?: string;
}

export async function resolveConfiguredMemoryRoot(
  options: ResolveConfiguredMemoryRootOptions
): Promise<MemoryRoot> {
  const envOverride = readOptionalString(options.env, MEMORY_ROOT_ENV_VAR)?.trim();
  if (envOverride && envOverride.length > 0) {
    return resolveAgainstCwd(options.cwd, envOverride);
  }

  const configOverride = readMemoryRoot(
    await readMergedDocumentReadonly(options.fs, options.configPath, options.projectConfigPath)
  )?.trim();
  if (configOverride && configOverride.length > 0) {
    return resolveAgainstCwd(options.cwd, configOverride);
  }

  return resolveMemoryRoot(options.cwd);
}

function readMemoryRoot(document: Record<string, unknown>): string | undefined {
  const memory = getOwnEntry(document, "memory");
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    return undefined;
  }

  return readOptionalString(memory as Record<string, unknown>, "root");
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function resolveAgainstCwd(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}
