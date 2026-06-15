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

  if (
    !(await assertFsCanonicalContainedPathIfPresent(
      fs,
      source.rootDir,
      configPath,
      "source.config"
    ))
  ) {
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

  const merged = deepMerge(cloneDefaultConfig() as unknown as Record<string, unknown>, parsed);
  validateSourceConfig(merged, configPath);
  return merged as unknown as SourceConfig;
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

function validateSourceConfig(config: Record<string, unknown>, configPath: string): void {
  const judge = requireRecord(config.judge, configPath, "judge");
  requireNonBlankString(judge.agent, configPath, "judge.agent");
  requireNonBlankString(judge.model, configPath, "judge.model");
  requireNonBlankString(config.out, configPath, "out");

  const weights = requireRecord(config.weights, configPath, "weights");
  requireWeight(weights.tests, configPath, "weights.tests");
  requireWeight(weights.judge, configPath, "weights.judge");

  if (config.clone_cache_dir !== null) {
    requireNonBlankString(config.clone_cache_dir, configPath, "clone_cache_dir");
  }
}

function requireRecord(
  value: unknown,
  configPath: string,
  fieldPath: string
): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  throw invalidConfigField(configPath, fieldPath, "object", value);
}

function requireNonBlankString(value: unknown, configPath: string, fieldPath: string): void {
  if (typeof value !== "string") {
    throw invalidConfigField(configPath, fieldPath, "string", value);
  }

  if (value.trim().length === 0) {
    throw invalidConfigField(configPath, fieldPath, "non-blank string", value);
  }
}

function requireWeight(value: unknown, configPath: string, fieldPath: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidConfigField(configPath, fieldPath, "number from 0 through 1", value);
  }
}

function invalidConfigField(
  configPath: string,
  fieldPath: string,
  expected: string,
  received: unknown
): Error {
  return new Error(
    `${configPath} (${fieldPath}): expected ${expected}, received ${formatReceived(received)}.`
  );
}

function formatReceived(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
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
