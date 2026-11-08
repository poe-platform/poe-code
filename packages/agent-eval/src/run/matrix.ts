import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { aggregateRuns } from "../aggregate.js";
import { hasOwnErrorCode } from "../error-codes.js";
import { openSource } from "../source/open.js";
import { listEvals, loadEval } from "../source/registry.js";
import type {
  EvalDef,
  EvalMatrixOptions,
  EvalRunOptions,
  EvalRunResult,
  PlanKind
} from "../types.js";
import { assertRunArtifactPath, ensureRunArtifactDirectory } from "./artifact-path.js";
import { runEval } from "./run.js";
import { writeRunResult } from "./result-writer.js";

const defaultRepeats = 3;
const tempWriteMaxAttempts = 3;

export async function* runMatrix(opts: EvalMatrixOptions): AsyncIterable<EvalRunResult> {
  assertNonEmpty("agents", opts.agents);
  assertNonEmpty("models", opts.models);

  const matrixId = new Date().toISOString();
  const source = await openSource(opts.sourceDir);
  const evalIds = opts.evalIds ?? (await listEvals(source));
  const repeats = opts.repeats ?? defaultRepeats;
  assertPositiveInteger("repeats", repeats);

  const matrixDir = path.join(opts.outDir ?? "runs", matrixId);
  await ensureRunArtifactDirectory(source.rootDir, matrixDir);

  for (const evalId of evalIds) {
    const evalDef = await loadEval(source, evalId);

    for (const agent of opts.agents) {
      for (const model of opts.models) {
        const cellRuns: EvalRunResult[] = [];

        for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
          const runOpts: EvalRunOptions = {
            sourceDir: opts.sourceDir,
            evalId,
            agent,
            model,
            outDir: matrixDir,
            cloneCacheDir: opts.cloneCacheDir,
            repeatIndex,
            verifyOracle: opts.verifyOracle,
            judge: opts.judge
          };

          const result = await runSingle(runOpts, {
            matrixId,
            planKind: evalDef.plan.kind,
            weights: evalDef.weights
          });
          cellRuns.push(result);
        }

        const aggregate = aggregateRuns(cellRuns);
        await writeAggregate(source.rootDir, matrixDir, evalId, agent, model, aggregate);
        for (const result of cellRuns) {
          yield result;
        }
      }
    }
  }
}

async function runSingle(
  opts: EvalRunOptions,
  context: {
    matrixId: string;
    planKind: PlanKind;
    weights: EvalDef["weights"];
  }
): Promise<EvalRunResult> {
  const startedAt = Date.now();

  try {
    return await runEval(opts);
  } catch (error) {
    const result = createErrorResult(opts, {
      matrixId: context.matrixId,
      planKind: context.planKind,
      weights: context.weights,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error)
    });
    const runDir = path.join(opts.outDir ?? "runs", result.runId);
    await ensureRunArtifactDirectory(opts.sourceDir, runDir);
    await writeRunResult(runDir, result);
    return result;
  }
}

function createErrorResult(
  opts: EvalRunOptions,
  context: {
    matrixId: string;
    planKind: PlanKind;
    weights: EvalDef["weights"];
    durationMs: number;
    error: string;
  }
): EvalRunResult {
  return {
    runId: `${context.matrixId}-${opts.evalId}-${safePathSegment(opts.agent)}-${safePathSegment(
      opts.model
    )}-r${opts.repeatIndex ?? 0}-error`,
    eval: opts.evalId,
    agent: opts.agent,
    model: opts.model,
    planKind: context.planKind,
    verdict: "error",
    correctness: 0,
    iterations: 0,
    durationMs: context.durationMs,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0
    },
    tests: {
      passed: 0,
      total: 0,
      pass_rate: 0,
      cases: []
    },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: context.weights.tests,
        effectiveWeight: 0,
        status: "skipped",
        reason: "framework_error"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: context.weights.judge,
        effectiveWeight: 0,
        status: opts.judge === "off" ? "disabled" : "skipped",
        reason: opts.judge === "off" ? "disabled" : "framework_error"
      }
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    trace: { available: false },
    error: context.error
  };
}

async function writeAggregate(
  sourceRootDir: string,
  matrixDir: string,
  evalId: string,
  agent: string,
  model: string,
  aggregate: unknown
): Promise<void> {
  const aggregatePath = path.join(
    matrixDir,
    `aggregate-${evalId}-${safePathSegment(agent)}-${safePathSegment(model)}.json`
  );
  await assertRunArtifactPath(sourceRootDir, aggregatePath);
  await writeFileAtomically(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  for (let attempt = 1; attempt <= tempWriteMaxAttempts; attempt += 1) {
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
    );

    try {
      await writeTempThenRename(tempPath, filePath, content);
      return;
    } catch (error) {
      if (isExistingPath(error) && attempt < tempWriteMaxAttempts) {
        continue;
      }
      throw error;
    }
  }
}

async function writeTempThenRename(tempPath: string, filePath: string, content: string): Promise<void> {
  let tempCreated = false;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await rename(tempPath, filePath);
  } catch (error) {
    if (tempCreated || !isExistingPath(error)) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

function assertNonEmpty(
  name: "agents" | "models",
  values: unknown
): asserts values is readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Eval matrix ${name} must be a non-empty array`);
  }
}

function assertPositiveInteger(name: "repeats", value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Eval matrix ${name} must be a positive integer`);
  }
}

function safePathSegment(value: string): string {
  let safe = "";

  for (const char of value) {
    safe += isSafePathSegmentChar(char) && char !== "~"
      ? char
      : `~${(char.codePointAt(0) as number).toString(16).padStart(6, "0")}`;
  }

  return safe;
}

function isSafePathSegmentChar(char: string): boolean {
  const code = char.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "." ||
    char === "_" ||
    char === "-"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExistingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}
