import path from "node:path";
import * as fsPromises from "node:fs/promises";
import YAML from "yaml";
import { isNotFound } from "@poe-code/config-mutations";

export type RalphConfig = {
  planPath?: string;
  progressPath?: string;
  guardrailsPath?: string;
  errorsLogPath?: string;
  activityLogPath?: string;
  agent?: string;
  maxIterations?: number;
  noCommit?: boolean;
  staleSeconds?: number;
};

type ConfigLoaderFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickOptionalString(config: Record<string, unknown>, key: keyof RalphConfig): string | undefined {
  const value = config[key as string];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Invalid "${String(key)}": expected a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function pickOptionalBoolean(config: Record<string, unknown>, key: keyof RalphConfig): boolean | undefined {
  const value = config[key as string];
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid "${String(key)}": expected a boolean.`);
  }
  return value;
}

function pickOptionalPositiveInt(
  config: Record<string, unknown>,
  key: keyof RalphConfig,
  options: { min: number }
): number | undefined {
  const value = config[key as string];
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Invalid "${String(key)}": expected an integer.`);
  }
  if (value < options.min) {
    throw new Error(`Invalid "${String(key)}": expected >= ${options.min}.`);
  }
  return value;
}


export async function loadConfig(
  cwd: string,
  deps?: { fs?: ConfigLoaderFileSystem }
): Promise<RalphConfig> {
  const fs = deps?.fs ?? (fsPromises as unknown as ConfigLoaderFileSystem);
  const configDir = path.join(cwd, ".agents", "poe-code-ralph");
  const yamlPath = path.join(configDir, "config.yaml");
  const jsonPath = path.join(configDir, "config.json");

  let raw: string | null = null;
  let format: "yaml" | "json" | null = null;
  let sourcePath: string | null = null;

  try {
    raw = await fs.readFile(yamlPath, "utf8");
    format = "yaml";
    sourcePath = yamlPath;
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  if (raw == null) {
    try {
      raw = await fs.readFile(jsonPath, "utf8");
      format = "json";
      sourcePath = jsonPath;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  if (raw == null || format == null || sourcePath == null) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = format === "yaml" ? YAML.parse(raw) : JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Ralph config ${format.toUpperCase()} at ${sourcePath}: ${detail}`, { cause: error });
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid Ralph config at ${sourcePath}: expected an object.`);
  }

  const config = parsed as Record<string, unknown>;
  const result: RalphConfig = {};

  const planPath = pickOptionalString(config, "planPath");
  if (planPath) result.planPath = planPath;
  const progressPath = pickOptionalString(config, "progressPath");
  if (progressPath) result.progressPath = progressPath;
  const guardrailsPath = pickOptionalString(config, "guardrailsPath");
  if (guardrailsPath) result.guardrailsPath = guardrailsPath;
  const errorsLogPath = pickOptionalString(config, "errorsLogPath");
  if (errorsLogPath) result.errorsLogPath = errorsLogPath;
  const activityLogPath = pickOptionalString(config, "activityLogPath");
  if (activityLogPath) result.activityLogPath = activityLogPath;
  const agent = pickOptionalString(config, "agent");
  if (agent) result.agent = agent;

  const maxIterations = pickOptionalPositiveInt(config, "maxIterations", { min: 1 });
  if (maxIterations != null) result.maxIterations = maxIterations;
  const staleSeconds = pickOptionalPositiveInt(config, "staleSeconds", { min: 0 });
  if (staleSeconds != null) result.staleSeconds = staleSeconds;

  const noCommit = pickOptionalBoolean(config, "noCommit");
  if (noCommit != null) result.noCommit = noCommit;

  return result;
}

