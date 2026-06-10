import nodeFs from "node:fs/promises";
import { join } from "node:path";

import { hasOwnErrorCode } from "../error-codes.js";
import type { EvalFs, EvalSource, SourceConfig } from "../types.js";
import { assertFsCanonicalContainedPathIfPresent } from "../path-boundary.js";

export const defaultSourceConfig: SourceConfig = Object.freeze({
  judge: Object.freeze({
    agent: "claude-code",
    model: "opus-4.7"
  }),
  out: "runs",
  weights: Object.freeze({
    tests: 0.7,
    judge: 0.3
  }),
  clone_cache_dir: null
});

export async function loadSourceConfig(source: EvalSource): Promise<SourceConfig>;
export async function loadSourceConfig(source: EvalSource, fs: EvalFs): Promise<SourceConfig>;
export async function loadSourceConfig(
  source: EvalSource,
  fs: EvalFs = nodeFs as unknown as EvalFs
): Promise<SourceConfig> {
  const configPath = join(source.rootDir, ".poe-code-eval.json");

  if (!(await assertFsCanonicalContainedPathIfPresent(fs, source.rootDir, configPath, "source.config"))) {
    return cloneDefaultConfig();
  }

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
  const result = Object.fromEntries(Object.entries(base)) as Record<string, unknown>;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const existing = Object.hasOwn(result, key) ? result[key] : undefined;
    if (isRecord(existing) && isRecord(value)) {
      Object.defineProperty(result, key, {
        value: deepMerge(existing, value),
        enumerable: true,
        configurable: true,
        writable: true
      });
      continue;
    }

    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
