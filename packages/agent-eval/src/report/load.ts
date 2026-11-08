import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { AggregatedCell, EvalRunResult, RunTraceSummary } from "../types.js";
import type { NormalizedTrace } from "../run/trace/types.js";
import { aggregateRuns } from "../aggregate.js";
import { hasOwnErrorCode } from "../error-codes.js";

const defaultOutDir = "runs";
const resultFileName = "result.json";
const aggregatePrefix = "aggregate-";
const jsonSuffix = ".json";

interface RunResultLocation {
  runId: string;
  resultPath: string;
}

export async function loadRunResult(runId: string, outDir = defaultOutDir): Promise<EvalRunResult> {
  assertValidRunId(runId);
  const directPath = path.join(outDir, runId, resultFileName);

  try {
    await assertCanonicalOutputFile(outDir, directPath);
    return enrichMatchedRunResult(runId, directPath);
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }

  const matches = (await findRunResults(outDir)).filter((location) => location.runId === runId);
  if (matches.length === 0) {
    throw new Error(`Run result not found for "${runId}" under ${outDir}`);
  }
  if (matches.length > 1) {
    throw new Error(`Run id "${runId}" is ambiguous under ${outDir}`);
  }

  const match = matches[0] as RunResultLocation;
  await assertCanonicalOutputFile(outDir, match.resultPath);
  return enrichMatchedRunResult(runId, match.resultPath);
}

export async function listRuns(outDir = defaultOutDir): Promise<readonly string[]> {
  const locations = await findRunResults(outDir);
  return locations.map((location) => location.runId).sort((a, b) => a.localeCompare(b));
}

export async function loadLatestMatrix(outDir = defaultOutDir): Promise<{
  matrixId: string;
  cells: readonly AggregatedCell[];
}> {
  const entries = await readRunsDir(outDir);
  const matrices: { matrixId: string; aggregateFiles: readonly string[] }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !hasTimestampPrefix(entry.name)) {
      continue;
    }

    const matrixDir = path.join(outDir, entry.name);
    const aggregateFiles = await listAggregateFiles(matrixDir);
    if (aggregateFiles.length > 0) {
      matrices.push({
        matrixId: entry.name,
        aggregateFiles
      });
    }
  }

  const latest = matrices.sort((a, b) => b.matrixId.localeCompare(a.matrixId))[0];
  if (!latest) {
    throw new Error(`No matrix aggregate files found under ${outDir}`);
  }

  const cells = await Promise.all(
    latest.aggregateFiles.map(async (fileName) => {
      const filePath = path.join(outDir, latest.matrixId, fileName);
      const cell = parseJson<AggregatedCell>(await readFile(filePath, "utf8"), filePath);
      return enrichAggregatedCell(cell, path.join(outDir, latest.matrixId));
    })
  );

  return {
    matrixId: latest.matrixId,
    cells
  };
}

async function enrichAggregatedCell(cell: AggregatedCell, outDir: string): Promise<AggregatedCell> {
  try {
    const runs = await Promise.all(cell.runIds.map((runId) => loadRunResult(runId, outDir)));
    const mismatchedRun = runs.find((run) => !matchesCell(run, cell.cell));
    if (mismatchedRun !== undefined) {
      throw new Error(
        `Aggregate cell references run "${mismatchedRun.runId}" from a different cell`
      );
    }
    return aggregateRuns(runs);
  } catch (error) {
    if (isRunResultNotFound(error)) {
      return cell;
    }
    throw error;
  }
}

async function enrichMatchedRunResult(runId: string, resultPath: string): Promise<EvalRunResult> {
  const result = validateRunResult(
    parseJson<unknown>(await readFile(resultPath, "utf8"), resultPath),
    resultPath
  );
  if (result.runId !== runId) {
    throw new Error(`Run result "${runId}" embeds mismatched runId "${result.runId}"`);
  }
  return enrichRunResult(result, path.dirname(resultPath));
}

function matchesCell(result: EvalRunResult, cell: AggregatedCell["cell"]): boolean {
  return (
    result.eval === cell.eval &&
    result.agent === cell.agent &&
    result.model === cell.model &&
    result.planKind === cell.planKind
  );
}

async function findRunResults(outDir: string): Promise<RunResultLocation[]> {
  const results: RunResultLocation[] = [];
  const entries = await readRunsDir(outDir);

  await collectRunResults(outDir, entries, results);
  return results;
}

async function collectRunResults(
  dir: string,
  entries: readonly Dirent[],
  results: RunResultLocation[]
): Promise<void> {
  const hasResult = entries.some((entry) => entry.isFile() && entry.name === resultFileName);
  if (hasResult) {
    results.push({
      runId: path.basename(dir),
      resultPath: path.join(dir, resultFileName)
    });
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childDir = path.join(dir, entry.name);
    const childEntries = await readDir(childDir);
    await collectRunResults(childDir, childEntries, results);
  }
}

async function listAggregateFiles(dir: string): Promise<readonly string[]> {
  const entries = await readDir(dir);
  return entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.startsWith(aggregatePrefix) && entry.name.endsWith(jsonSuffix)
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readRunsDir(outDir: string): Promise<readonly Dirent[]> {
  try {
    return await readDir(outDir);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new Error(`Runs directory not found: ${outDir}`);
    }
    throw error;
  }
}

async function readDir(dir: string): Promise<readonly Dirent[]> {
  return readdir(dir, { withFileTypes: true }) as Promise<Dirent[]>;
}

function parseJson<T>(content: string, filePath: string): T {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}

async function enrichRunResult(result: EvalRunResult, runDir: string): Promise<EvalRunResult> {
  if (result.trace !== undefined) {
    return result;
  }
  return {
    ...result,
    trace: await loadTraceSummary(path.join(runDir, "trace.json"), path.dirname(runDir))
  };
}

async function loadTraceSummary(tracePath: string, outDir: string): Promise<RunTraceSummary> {
  try {
    await assertCanonicalOutputFile(outDir, tracePath);
    const trace = validateTrace(
      parseJson<unknown>(await readFile(tracePath, "utf8"), tracePath),
      tracePath
    );
    return {
      available: true,
      eventCount: trace.events.length,
      toolEventCount: trace.events.filter((event) => event.type === "tool").length,
      errorEventCount: trace.events.filter((event) => event.type === "error").length
    };
  } catch (error) {
    if (isMissingPath(error)) {
      return { available: false };
    }
    throw error;
  }
}

function validateRunResult(value: unknown, filePath: string): EvalRunResult {
  const result = requireRecord(value, filePath, "result.json", []);
  requireString(result.runId, filePath, "result.json", ["runId"]);
  requireString(result.eval, filePath, "result.json", ["eval"]);
  requireString(result.agent, filePath, "result.json", ["agent"]);
  requireString(result.model, filePath, "result.json", ["model"]);
  requireString(result.planKind, filePath, "result.json", ["planKind"]);
  requireString(result.verdict, filePath, "result.json", ["verdict"]);
  requireNonNegativeInteger(result.iterations, filePath, "result.json", ["iterations"]);
  requireNonNegativeNumber(result.durationMs, filePath, "result.json", ["durationMs"]);
  requireRange(result.correctness, 0, 1, filePath, "result.json", ["correctness"]);

  const usage = requireRecord(result.usage, filePath, "result.json", ["usage"]);
  requireNonNegativeInteger(usage.inputTokens, filePath, "result.json", ["usage", "inputTokens"]);
  requireNonNegativeInteger(usage.outputTokens, filePath, "result.json", ["usage", "outputTokens"]);
  if (usage.cachedTokens !== undefined) {
    requireNonNegativeInteger(usage.cachedTokens, filePath, "result.json", [
      "usage",
      "cachedTokens"
    ]);
  }
  if (usage.costUsd !== undefined) {
    requireNonNegativeNumber(usage.costUsd, filePath, "result.json", ["usage", "costUsd"]);
  }

  const tests = requireRecord(result.tests, filePath, "result.json", ["tests"]);
  const passed = requireNonNegativeInteger(tests.passed, filePath, "result.json", [
    "tests",
    "passed"
  ]);
  const total = requireNonNegativeInteger(tests.total, filePath, "result.json", ["tests", "total"]);
  if (passed > total) {
    throw invalidArtifactField(
      filePath,
      "result.json",
      ["tests", "passed"],
      "integer less than or equal to tests.total",
      passed
    );
  }
  requireRange(tests.pass_rate, 0, 1, filePath, "result.json", ["tests", "pass_rate"]);
  if (!Array.isArray(tests.cases)) {
    throw invalidArtifactField(filePath, "result.json", ["tests", "cases"], "array", tests.cases);
  }

  const scoring = requireRecord(result.scoring, filePath, "result.json", ["scoring"]);
  validateScoringComponent(scoring.tests, filePath, ["scoring", "tests"]);
  validateScoringComponent(scoring.judge, filePath, ["scoring", "judge"]);
  requireBoolean(result.cheated, filePath, "result.json", ["cheated"]);
  requireRecord(result.cheatReport, filePath, "result.json", ["cheatReport"]);

  return result as unknown as EvalRunResult;
}

function validateScoringComponent(value: unknown, filePath: string, path: readonly string[]): void {
  const component = requireRecord(value, filePath, "result.json", path);
  requireBoolean(component.configured, filePath, "result.json", [...path, "configured"]);
  requireBoolean(component.required, filePath, "result.json", [...path, "required"]);
  requireRange(component.configuredWeight, 0, 1, filePath, "result.json", [
    ...path,
    "configuredWeight"
  ]);
  requireRange(component.effectiveWeight, 0, 1, filePath, "result.json", [
    ...path,
    "effectiveWeight"
  ]);
  requireString(component.status, filePath, "result.json", [...path, "status"]);
}

function validateTrace(value: unknown, filePath: string): NormalizedTrace {
  const trace = requireRecord(value, filePath, "trace.json", []);
  if (!Array.isArray(trace.events)) {
    throw invalidArtifactField(filePath, "trace.json", ["events"], "array", trace.events);
  }
  return trace as unknown as NormalizedTrace;
}

function requireRecord(
  value: unknown,
  filePath: string,
  artifact: string,
  path: readonly string[]
): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw invalidArtifactField(filePath, artifact, path, "object", value);
}

function requireString(
  value: unknown,
  filePath: string,
  artifact: string,
  path: readonly string[]
): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw invalidArtifactField(filePath, artifact, path, "non-empty string", value);
}

function requireBoolean(
  value: unknown,
  filePath: string,
  artifact: string,
  path: readonly string[]
): void {
  if (typeof value !== "boolean") {
    throw invalidArtifactField(filePath, artifact, path, "boolean", value);
  }
}

function requireNonNegativeInteger(
  value: unknown,
  filePath: string,
  artifact: string,
  path: readonly string[]
): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw invalidArtifactField(filePath, artifact, path, "non-negative integer", value);
}

function requireNonNegativeNumber(
  value: unknown,
  filePath: string,
  artifact: string,
  path: readonly string[]
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw invalidArtifactField(filePath, artifact, path, "non-negative number", value);
}

function requireRange(
  value: unknown,
  min: number,
  max: number,
  filePath: string,
  artifact: string,
  path: readonly string[]
): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
    return;
  }
  throw invalidArtifactField(filePath, artifact, path, `number from ${min} through ${max}`, value);
}

function invalidArtifactField(
  filePath: string,
  artifact: string,
  path: readonly string[],
  expected: string,
  received: unknown
): Error {
  return new Error(
    `Invalid ${artifact} in ${filePath} (${formatIssuePath(path)}): expected ${expected}, received ${formatReceived(received)}.`
  );
}

function formatIssuePath(path: readonly string[]): string {
  return path.join(".") || "value";
}

function formatReceived(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "object" && value !== null) {
    return Array.isArray(value) ? "array" : "object";
  }
  return String(value);
}

async function assertCanonicalOutputFile(outDir: string, filePath: string): Promise<void> {
  const canonicalOutDir = await realpath(path.resolve(outDir));
  const canonicalFilePath = await realpath(filePath);
  const relative = path.relative(canonicalOutDir, canonicalFilePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("run result must stay within the canonical output directory.");
  }
}

function assertValidRunId(runId: string): void {
  if (
    runId.length === 0 ||
    runId === "." ||
    runId === ".." ||
    path.isAbsolute(runId) ||
    path.win32.isAbsolute(runId) ||
    runId.includes("/") ||
    runId.includes("\\")
  ) {
    throw new Error(`Invalid run id "${runId}"`);
  }
}

function hasTimestampPrefix(value: string): boolean {
  return (
    hasDigits(value, 0, 4) &&
    value[4] === "-" &&
    hasDigits(value, 5, 2) &&
    value[7] === "-" &&
    hasDigits(value, 8, 2)
  );
}

function isRunResultNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Run result not found for ");
}

function hasDigits(value: string, start: number, length: number): boolean {
  if (value.length < start + length) {
    return false;
  }

  for (let index = start; index < start + length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
