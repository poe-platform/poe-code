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

export type ConfigSource = {
  path: string;
  scope: "global" | "local";
};

export type LoadConfigResult = {
  config: RalphConfig;
  sources: ConfigSource[];
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

type SingleConfigResult = {
  config: RalphConfig;
  sourcePath: string;
};

async function loadSingleConfig(
  configDir: string,
  fs: ConfigLoaderFileSystem
): Promise<SingleConfigResult | null> {
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
    return null;
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

  const rawConfig = parsed as Record<string, unknown>;
  const config: RalphConfig = {};

  const planPath = pickOptionalString(rawConfig, "planPath");
  if (planPath) config.planPath = planPath;
  const progressPath = pickOptionalString(rawConfig, "progressPath");
  if (progressPath) config.progressPath = progressPath;
  const guardrailsPath = pickOptionalString(rawConfig, "guardrailsPath");
  if (guardrailsPath) config.guardrailsPath = guardrailsPath;
  const errorsLogPath = pickOptionalString(rawConfig, "errorsLogPath");
  if (errorsLogPath) config.errorsLogPath = errorsLogPath;
  const activityLogPath = pickOptionalString(rawConfig, "activityLogPath");
  if (activityLogPath) config.activityLogPath = activityLogPath;
  const agent = pickOptionalString(rawConfig, "agent");
  if (agent) config.agent = agent;

  const maxIterations = pickOptionalPositiveInt(rawConfig, "maxIterations", { min: 1 });
  if (maxIterations != null) config.maxIterations = maxIterations;
  const staleSeconds = pickOptionalPositiveInt(rawConfig, "staleSeconds", { min: 0 });
  if (staleSeconds != null) config.staleSeconds = staleSeconds;

  const noCommit = pickOptionalBoolean(rawConfig, "noCommit");
  if (noCommit != null) config.noCommit = noCommit;

  return { config, sourcePath };
}

function mergeConfigs(base: RalphConfig, override: RalphConfig): RalphConfig {
  const result: RalphConfig = { ...base };
  for (const key of Object.keys(override) as (keyof RalphConfig)[]) {
    if (override[key] !== undefined) {
      (result as Record<string, unknown>)[key] = override[key];
    }
  }
  return result;
}

export async function loadConfig(
  cwd: string,
  deps?: { fs?: ConfigLoaderFileSystem; homeDir?: string }
): Promise<LoadConfigResult> {
  const fs = deps?.fs ?? (fsPromises as unknown as ConfigLoaderFileSystem);
  const sources: ConfigSource[] = [];

  let merged: RalphConfig = {};

  if (deps?.homeDir) {
    const globalDir = path.join(deps.homeDir, ".poe-code", "ralph");
    const globalResult = await loadSingleConfig(globalDir, fs);
    if (globalResult) {
      merged = globalResult.config;
      sources.push({ path: globalResult.sourcePath, scope: "global" });
    }
  }

  const localDir = path.join(cwd, ".agents", "poe-code-ralph");
  const localResult = await loadSingleConfig(localDir, fs);
  if (localResult) {
    merged = mergeConfigs(merged, localResult.config);
    sources.push({ path: localResult.sourcePath, scope: "local" });
  }

  return { config: merged, sources };
}
