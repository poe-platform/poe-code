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
      throw new Error(`Aggregate cell references run "${mismatchedRun.runId}" from a different cell`);
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
  const result = parseJson<EvalRunResult>(await readFile(resultPath, "utf8"), resultPath);
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
    const trace = parseJson<NormalizedTrace>(await readFile(tracePath, "utf8"), tracePath);
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
