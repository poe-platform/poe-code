import nodeFs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { EvalYamlValidationError, validateEvalYaml, type EvalYaml } from "../schema.js";
import type { EvalFs } from "../types.js";
import { hasOwnErrorCode } from "../error-codes.js";
import { assertFsCanonicalContainedPathIfPresent } from "../path-boundary.js";
import { assertSafeEvalId } from "../source/registry.js";

export interface LintIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface LintResult {
  evalId: string;
  issues: readonly LintIssue[];
}

interface ParsedEvalYaml {
  raw: unknown;
  valid: EvalYaml | undefined;
}

const allowedPlanKinds = ["plan", "pipeline", "superintendent", "experiment"] as const;

export async function evalLint(input: { sourceDir: string; evalId: string }): Promise<LintResult> {
  assertSafeEvalId(input.evalId);

  const fs = nodeFs as unknown as EvalFs;
  const evalDir = path.join(input.sourceDir, input.evalId);
  const issues: LintIssue[] = [];
  const parsedEvalYaml = await lintEvalYaml(evalDir, issues, fs);
  const frontmatter = await lintPlan(evalDir, issues, fs);
  const oraclePath = readOraclePath(parsedEvalYaml.valid, parsedEvalYaml.raw);

  if (frontmatter !== undefined && !allowedPlanKinds.includes(frontmatter.kind as never)) {
    issues.push({
      severity: "error",
      code: "E003",
      message: `plan.md frontmatter kind must be one of: ${allowedPlanKinds.join(", ")}.`,
      path: path.join(evalDir, "plan.md")
    });
  }

  const oracleDir = path.join(evalDir, oraclePath);
  if (!(await isDirectory(oracleDir, fs))) {
    issues.push({
      severity: "error",
      code: "E004",
      message: `${oraclePath}/ directory is missing.`,
      path: oracleDir
    });
  }

  const hasScorerCommand =
    readScorerCommand(parsedEvalYaml.valid, parsedEvalYaml.raw) !== undefined;
  const hasOracleTests = await hasDefaultOracleTests(path.join(oracleDir, "tests"), fs);
  if (!hasScorerCommand && !hasOracleTests) {
    issues.push({
      severity: "error",
      code: "E005",
      message: "No scorer.command and no oracle/tests/*.test.ts files found.",
      path: path.join(oracleDir, "tests")
    });
  }

  if (!(await hasDirectoryEntries(path.join(oracleDir, "solution"), fs))) {
    issues.push({
      severity: "warning",
      code: "W001",
      message: `${oraclePath}/solution/ is missing or empty; eval check will fail.`,
      path: path.join(oracleDir, "solution")
    });
  }

  const starterDir = path.join(evalDir, "starter");
  if ((await isDirectory(starterDir, fs)) && !(await hasDirectoryEntries(starterDir, fs))) {
    issues.push({
      severity: "warning",
      code: "W002",
      message: "starter/ directory is present but empty.",
      path: starterDir
    });
  }

  const wallClockMs = readBudgetWallClockMs(parsedEvalYaml.valid, parsedEvalYaml.raw);
  if (wallClockMs !== undefined && wallClockMs < 60_000) {
    issues.push({
      severity: "warning",
      code: "W003",
      message: "budget.wall_clock_ms is below 60000 and is likely too short.",
      path: path.join(evalDir, "eval.yaml")
    });
  }

  const targetRef = readTargetRef(parsedEvalYaml.valid, parsedEvalYaml.raw);
  if (targetRef !== undefined && isUnpinnedRef(targetRef)) {
    issues.push({
      severity: "warning",
      code: "W004",
      message: `target.ref "${targetRef}" is not a full commit SHA; pin it to a commit SHA.`,
      path: path.join(evalDir, "eval.yaml")
    });
  }

  return {
    evalId: input.evalId,
    issues
  };
}

async function lintEvalYaml(
  evalDir: string,
  issues: LintIssue[],
  fs: EvalFs
): Promise<ParsedEvalYaml> {
  const evalYamlPath = path.join(evalDir, "eval.yaml");
  if (!(await assertFsCanonicalContainedPathIfPresent(fs, path.dirname(evalDir), evalYamlPath, "eval.yaml"))) {
    issues.push({ severity: "error", code: "E001", message: "eval.yaml is missing.", path: evalYamlPath });
    return { raw: undefined, valid: undefined };
  }
  const content = await readTextIfPresent(evalYamlPath, fs);

  if (content === undefined) {
    issues.push({
      severity: "error",
      code: "E001",
      message: "eval.yaml is missing.",
      path: evalYamlPath
    });
    return { raw: undefined, valid: undefined };
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
    return {
      raw,
      valid: validateEvalYaml(raw, evalYamlPath)
    };
  } catch (error) {
    issues.push({
      severity: "error",
      code: "E001",
      message: `eval.yaml failed schema validation: ${formatValidationError(error)}`,
      path: evalYamlPath
    });
    return { raw, valid: undefined };
  }
}

async function lintPlan(
  evalDir: string,
  issues: LintIssue[],
  fs: EvalFs
): Promise<Record<string, unknown> | undefined> {
  const planPath = path.join(evalDir, "plan.md");
  if (!(await assertFsCanonicalContainedPathIfPresent(fs, path.dirname(evalDir), planPath, "plan.md"))) {
    issues.push({ severity: "error", code: "E002", message: "plan.md is missing.", path: planPath });
    return undefined;
  }
  const content = await readTextIfPresent(planPath, fs);

  if (content === undefined) {
    issues.push({
      severity: "error",
      code: "E002",
      message: "plan.md is missing.",
      path: planPath
    });
    return undefined;
  }

  try {
    return parsePlanFrontmatter(content, planPath);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "E002",
      message: `plan.md frontmatter failed to parse: ${getErrorMessage(error)}`,
      path: planPath
    });
    return undefined;
  }
}

function parsePlanFrontmatter(content: string, filePath: string): Record<string, unknown> {
  const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lineBreak = normalized.startsWith("---\r\n") ? "\r\n" : "\n";

  if (!normalized.startsWith(`---${lineBreak}`)) {
    return {};
  }

  const afterOpening = normalized.slice(3 + lineBreak.length);
  const lines = afterOpening.split(lineBreak);
  const closingIndex = lines.findIndex((line) => line === "---");

  if (closingIndex === -1) {
    throw new Error("missing closing frontmatter delimiter.");
  }

  const yamlContent = lines.slice(0, closingIndex).join(lineBreak);
  const parsed = parseYaml(yamlContent);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error(`${filePath} frontmatter must be a YAML mapping.`);
  }

  return { ...parsed };
}

async function readTextIfPresent(filePath: string, fs: EvalFs): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function isDirectory(dirPath: string, fs: EvalFs): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

async function hasDirectoryEntries(dirPath: string, fs: EvalFs): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.length > 0;
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

async function hasDefaultOracleTests(testsDir: string, fs: EvalFs): Promise<boolean> {
  try {
    const entries = await fs.readdir(testsDir, { withFileTypes: true });
    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!name.endsWith(".test.ts")) {
        continue;
      }
      if (typeof entry !== "string" && !entry.isFile()) {
        continue;
      }
      return true;
    }
    return false;
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

function readOraclePath(valid: EvalYaml | undefined, raw: unknown): string {
  if (valid !== undefined) {
    return valid.oracle.path ?? "oracle";
  }

  const oracle = readRecord(raw, "oracle");
  const oraclePath = readString(oracle, "path");
  return oraclePath ?? "oracle";
}

function readScorerCommand(valid: EvalYaml | undefined, raw: unknown): string | undefined {
  if (valid !== undefined) {
    return valid.scorer?.command;
  }

  return readString(readRecord(raw, "scorer"), "command");
}

function readBudgetWallClockMs(valid: EvalYaml | undefined, raw: unknown): number | undefined {
  if (valid !== undefined) {
    return valid.budget.wall_clock_ms;
  }

  return readNumber(readRecord(raw, "budget"), "wall_clock_ms");
}

function readTargetRef(valid: EvalYaml | undefined, raw: unknown): string | undefined {
  if (valid !== undefined) {
    return valid.target.ref;
  }

  return readString(readRecord(raw, "target"), "ref");
}

function isUnpinnedRef(value: string): boolean {
  return !isFullGitSha(value);
}

function isFullGitSha(value: string): boolean {
  if (value.length !== 40) {
    return false;
  }

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    const isUpperHex = code >= 65 && code <= 70;
    if (!isDigit && !isLowerHex && !isUpperHex) {
      return false;
    }
  }

  return true;
}

function readRecord(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValidationError(error: unknown): string {
  if (error instanceof EvalYamlValidationError) {
    return error.message;
  }

  return getErrorMessage(error);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
