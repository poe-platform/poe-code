import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createHostRunner,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";
import type { ScorerSpec } from "../types.js";

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

export async function runScorer(
  cloneDir: string,
  oracleDir: string,
  spec: ScorerSpec
): Promise<{ passed: number; total: number }> {
  const absoluteCloneDir = path.resolve(cloneDir);
  const absoluteOracleDir = path.resolve(oracleDir);
  const result = await runScorerCommand(createHostRunner(), {
    command: spec.command,
    cwd: path.join(absoluteCloneDir, spec.cwd),
    env: createScorerEnv(absoluteCloneDir, absoluteOracleDir),
    timeoutMs: spec.timeoutMs
  });

  if (result.timedOut) {
    throw new ScorerTimeoutError(`Scorer timed out after ${spec.timeoutMs}ms`);
  }

  const resultPath = path.join(absoluteCloneDir, spec.resultPath);
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
  }
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const handle = runner.exec(createShellRunSpec(input));
  const stdout = captureStream(handle.stdout);
  const stderr = captureStream(handle.stderr);
  const timedResult = await waitForResult(handle, input.timeoutMs);

  if (timedResult.timedOut) {
    killQuietly(handle);
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
}): RunSpec {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", input.command],
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe"
    };
  }

  return {
    command: "sh",
    args: ["-c", input.command],
    cwd: input.cwd,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe"
  };
}

function createScorerEnv(cloneDir: string, oracleDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

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
): { passed: number; total: number } {
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
    typeof (parsed as { total?: unknown }).total !== "number"
  ) {
    throw new ScorerError(
      `Malformed scorer result ${resultPath}: expected { passed: number, total: number }`
    );
  }

  return {
    passed: (parsed as { passed: number }).passed,
    total: (parsed as { total: number }).total
  };
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function killQuietly(handle: RunHandle): void {
  try {
    handle.kill("SIGTERM");
  } catch {
    // Best effort cleanup after the configured scorer timeout.
  }
}
