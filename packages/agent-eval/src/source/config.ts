import nodeFs from "node:fs/promises";
import { join } from "node:path";

import type { EvalFs, EvalSource, SourceConfig } from "../types.js";

export const defaultSourceConfig: SourceConfig = {
  judge: {
    agent: "claude-code",
    model: "opus-4.7"
  },
  out: "runs",
  weights: {
    tests: 0.7,
    judge: 0.3
  },
  clone_cache_dir: null
};

export async function loadSourceConfig(source: EvalSource): Promise<SourceConfig>;
export async function loadSourceConfig(source: EvalSource, fs: EvalFs): Promise<SourceConfig>;
export async function loadSourceConfig(
  source: EvalSource,
  fs: EvalFs = nodeFs as unknown as EvalFs
): Promise<SourceConfig> {
  const configPath = join(source.rootDir, ".poe-code-eval.json");

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingPath(error)) {
      return cloneDefaultConfig();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${configPath}: ${getErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }

  return deepMerge(
    cloneDefaultConfig() as unknown as Record<string, unknown>,
    parsed
  ) as unknown as SourceConfig;
}

function cloneDefaultConfig(): SourceConfig {
  return {
    judge: { ...defaultSourceConfig.judge },
    out: defaultSourceConfig.out,
    weights: { ...defaultSourceConfig.weights },
    clone_cache_dir: defaultSourceConfig.clone_cache_dir
  };
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];
    if (isRecord(existing) && isRecord(value)) {
      result[key] = deepMerge(existing, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
