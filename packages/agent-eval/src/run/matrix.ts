import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { aggregateRuns } from "../aggregate.js";
import { openSource } from "../source/open.js";
import { listEvals, loadEval } from "../source/registry.js";
import type { EvalMatrixOptions, EvalRunOptions, EvalRunResult, PlanKind } from "../types.js";
import { runEval } from "./run.js";

const defaultRepeats = 3;

export async function* runMatrix(opts: EvalMatrixOptions): AsyncIterable<EvalRunResult> {
  assertNonEmpty("agents", opts.agents);
  assertNonEmpty("models", opts.models);

  const matrixId = new Date().toISOString();
  const source = await openSource(opts.sourceDir);
  const evalIds = opts.evalIds ?? (await listEvals(source));
  const repeats = opts.repeats ?? defaultRepeats;
  assertPositiveInteger("repeats", repeats);

  const matrixDir = path.join(opts.outDir ?? "runs", matrixId);
  await mkdir(matrixDir, { recursive: true });

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
            planKind: evalDef.plan.kind
          });
          cellRuns.push(result);
          yield result;
        }

        const aggregate = aggregateRuns(cellRuns);
        await writeAggregate(matrixDir, evalId, agent, model, aggregate);
      }
    }
  }
}

async function runSingle(
  opts: EvalRunOptions,
  context: {
    matrixId: string;
    planKind: PlanKind;
  }
): Promise<EvalRunResult> {
  const startedAt = Date.now();

  try {
    return await runEval(opts);
  } catch (error) {
    return createErrorResult(opts, {
      matrixId: context.matrixId,
      planKind: context.planKind,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error)
    });
  }
}

function createErrorResult(
  opts: EvalRunOptions,
  context: {
    matrixId: string;
    planKind: PlanKind;
    durationMs: number;
    error: string;
  }
): EvalRunResult {
  return {
    runId: `${context.matrixId}-${opts.evalId}-${opts.agent}-${safePathSegment(
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
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    error: context.error
  };
}

async function writeAggregate(
  matrixDir: string,
  evalId: string,
  agent: string,
  model: string,
  aggregate: unknown
): Promise<void> {
  await writeFile(
    path.join(matrixDir, `aggregate-${evalId}-${agent}-${safePathSegment(model)}.json`),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    "utf8"
  );
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
    safe += isSafePathSegmentChar(char) ? char : "-";
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
