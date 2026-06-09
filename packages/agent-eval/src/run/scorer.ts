import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createHostRunner,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";
import { hasOwnErrorCode } from "../error-codes.js";
import { resolveScorer, type EvalDef, type ScorerSpec } from "../types.js";
import { assertCanonicalContainedPath, resolveContainedPath } from "../path-boundary.js";
import { terminateRunHandle } from "./subprocess-termination.js";
import { runVitest, type CaseResult } from "./vitest-runner.js";

const defaultVitestTimeoutMs = 180_000;

export class ScorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorerError";
  }
}

export class ScorerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorerTimeoutError";
  }
}

export async function runScorer(input: {
  evalDef: EvalDef;
  evalDir: string;
  cloneDir: string;
  signal?: AbortSignal;
}): Promise<{ passed: number; total: number; cases: CaseResult[] }> {
  const scorer = resolveScorer(input.evalDef);
  const absoluteEvalDir = path.resolve(input.evalDir);
  const absoluteCloneDir = path.resolve(input.cloneDir);
  const oracleDir = resolveContainedPath(absoluteEvalDir, input.evalDef.oracle.path, "oracle.path");
  await assertCanonicalContainedPath(absoluteEvalDir, oracleDir, "oracle.path");

  if (scorer.kind === "vitest") {
    return runVitest({
      testsDir: path.join(oracleDir, "tests"),
      cloneDir: absoluteCloneDir,
      oracleDir,
      timeoutMs: defaultVitestTimeoutMs,
      signal: input.signal
    });
  }

  return runCustomScorer({
    cloneDir: absoluteCloneDir,
    oracleDir,
    spec: scorer.spec,
    signal: input.signal
  });
}

async function runCustomScorer(input: {
  cloneDir: string;
  oracleDir: string;
  spec: ScorerSpec;
  signal?: AbortSignal;
}): Promise<{ passed: number; total: number; cases: CaseResult[] }> {
  assertValidTimeout(input.spec.timeoutMs);
  const cwd = resolveContainedPath(input.cloneDir, input.spec.cwd, "scorer.cwd");
  const resultPath = resolveContainedPath(
    input.cloneDir,
    input.spec.resultPath,
    "scorer.result_path"
  );
  await assertCanonicalContainedPath(input.cloneDir, cwd, "scorer.cwd");
  const result = await runScorerCommand(createHostRunner(), {
    command: input.spec.command,
    cwd,
    env: createScorerEnv(input.cloneDir, input.oracleDir),
    timeoutMs: input.spec.timeoutMs,
    signal: input.signal
  });

  if (result.timedOut) {
    throw new ScorerTimeoutError(`Scorer timed out after ${input.spec.timeoutMs}ms`);
  }

  await assertCanonicalContainedPath(input.cloneDir, resultPath, "scorer.result_path");
  const rawResult = await readScorerResult(resultPath, result);
  return parseScorerResult(resultPath, rawResult);
}

async function runScorerCommand(
  runner: Runner,
  input: {
    command: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const handle = runner.exec(createShellRunSpec(input));
  const stdout = captureStream(handle.stdout);
  const stderr = captureStream(handle.stderr);
  const timedResult = await waitForResult(handle, input.timeoutMs);

  if (timedResult.timedOut) {
    await terminateRunHandle(handle);
    return {
      exitCode: timedResult.exitCode,
      stdout: stdout.output(),
      stderr: stderr.output(),
      timedOut: true
    };
  }

  await Promise.all([stdout.finished, stderr.finished]);

  return {
    exitCode: timedResult.exitCode,
    stdout: stdout.output(),
    stderr: stderr.output(),
    timedOut: false
  };
}

function createShellRunSpec(input: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
}): RunSpec {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", input.command],
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      signal: input.signal,
      killProcessGroup: true
    };
  }

  return {
    command: "sh",
    args: ["-c", input.command],
    cwd: input.cwd,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
    killProcessGroup: true
  };
}

function createScorerEnv(cloneDir: string, oracleDir: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );

  env.CLONE_DIR = cloneDir;
  env.ORACLE_DIR = oracleDir;
  return env;
}

async function readScorerResult(
  resultPath: string,
  result: { exitCode: number; stdout: string; stderr: string }
): Promise<string> {
  try {
    return await readFile(resultPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      if (result.exitCode !== 0) {
        throw new ScorerError(
          [
            `Scorer exited with code ${result.exitCode} and did not write result file: ${resultPath}`,
            `stdout:\n${result.stdout}`,
            `stderr:\n${result.stderr}`
          ].join("\n")
        );
      }

      throw new ScorerError(`Scorer result file is missing: ${resultPath}`);
    }

    throw new ScorerError(
      `Failed to read scorer result ${resultPath}: ${formatUnknownError(error)}`
    );
  }
}

function parseScorerResult(
  resultPath: string,
  rawResult: string
): { passed: number; total: number; cases: CaseResult[] } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawResult);
  } catch (error) {
    throw new ScorerError(
      `Failed to parse scorer result ${resultPath}: ${formatUnknownError(error)}`
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { passed?: unknown }).passed !== "number" ||
    !Number.isFinite((parsed as { passed: number }).passed) ||
    typeof (parsed as { total?: unknown }).total !== "number" ||
    !Number.isFinite((parsed as { total: number }).total)
  ) {
    throw new ScorerError(
      `Malformed scorer result ${resultPath}: expected { passed: number, total: number }`
    );
  }

  const cases = (parsed as { cases?: unknown }).cases;
  if (cases !== undefined && !isCaseResults(cases)) {
    throw new ScorerError(
      `Malformed scorer result ${resultPath}: expected cases to be CaseResult[]`
    );
  }

  return {
    passed: (parsed as { passed: number }).passed,
    total: (parsed as { total: number }).total,
    cases: cases ?? []
  };
}

function isCaseResults(value: unknown): value is CaseResult[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CaseResult).name === "string" &&
        typeof (item as CaseResult).passed === "boolean" &&
        typeof (item as CaseResult).durationMs === "number" &&
        Number.isFinite((item as CaseResult).durationMs) &&
        ((item as CaseResult).message === undefined ||
          typeof (item as CaseResult).message === "string")
    )
  );
}

function assertValidTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new ScorerError("Scorer timeout must be a finite non-negative number.");
  }
}

async function waitForResult(
  handle: RunHandle,
  timeoutMs: number
): Promise<{ exitCode: number; timedOut: boolean }> {
  let timeout: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<{ exitCode: number; timedOut: true }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ exitCode: 1, timedOut: true });
    }, timeoutMs);
  });

  const result = await Promise.race([
    handle.result.then((runResult) => ({
      exitCode: runResult.exitCode,
      timedOut: false as const
    })),
    timeoutPromise
  ]);

  if (timeout !== null) {
    clearTimeout(timeout);
  }

  return result;
}

function captureStream(stream: NodeJS.ReadableStream | null): {
  output(): string;
  finished: Promise<void>;
} {
  if (stream === null) {
    return {
      output: () => "",
      finished: Promise.resolve()
    };
  }

  let output = "";
  stream.setEncoding("utf8");

  const finished = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.once("end", resolve);
    stream.once("error", reject);
  });

  return {
    output: () => output,
    finished
  };
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
