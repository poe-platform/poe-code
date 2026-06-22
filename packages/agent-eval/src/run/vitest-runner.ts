import { randomUUID } from "node:crypto";
import { readFile, realpath, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createHostRunner,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";
import { terminateRunHandle } from "./subprocess-termination.js";

const require = createRequire(import.meta.url);
const defaultTimeoutMs = 180_000;

export interface CaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  message?: string;
}

export class VitestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VitestTimeoutError";
  }
}

export class VitestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VitestError";
  }
}

export async function runVitest(input: {
  testsDir: string;
  cloneDir: string;
  oracleDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ passed: number; total: number; cases: CaseResult[] }> {
  return runVitestWithRunner(createHostRunner(), input);
}

async function runVitestWithRunner(
  runner: Runner,
  input: {
    testsDir: string;
    cloneDir: string;
    oracleDir: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<{ passed: number; total: number; cases: CaseResult[] }> {
  const outputFile = path.join(tmpdir(), `poe-code-vitest-${process.pid}-${randomUUID()}.json`);
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  assertValidTimeout(timeoutMs);
  const resolvedInput = await resolveVitestInputPaths(input);
  const handle = runner.exec(createVitestRunSpec(resolvedInput, outputFile));
  const stdout = drainStream(handle.stdout).catch(() => undefined);
  const stderr = drainStream(handle.stderr).catch(() => undefined);

  try {
    const runResult = await waitForVitest(handle, timeoutMs, input.signal);
    await Promise.all([stdout, stderr]);
    const raw = await readFile(outputFile, "utf8");
    const cases = mapVitestCases(JSON.parse(raw), resolvedInput.testsDir);
    if (runResult.exitCode !== 0 && cases.every((result) => result.passed)) {
      throw new VitestError(`Vitest exited with code ${runResult.exitCode}.`);
    }

    return {
      passed: cases.filter((result) => result.passed).length,
      total: cases.length,
      cases
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new VitestError(`Failed to parse vitest JSON output: ${error.message}`);
    }
    throw error;
  } finally {
    await unlink(outputFile).catch(() => undefined);
  }
}

async function resolveVitestInputPaths(input: {
  testsDir: string;
  cloneDir: string;
  oracleDir: string;
  signal?: AbortSignal;
}): Promise<{
  testsDir: string;
  cloneDir: string;
  oracleDir: string;
  signal?: AbortSignal;
}> {
  return {
    testsDir: await resolveRealPath(input.testsDir),
    cloneDir: await resolveRealPath(input.cloneDir),
    oracleDir: await resolveRealPath(input.oracleDir),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  };
}

async function resolveRealPath(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  try {
    return await realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function createVitestRunSpec(
  input: {
    testsDir: string;
    cloneDir: string;
    oracleDir: string;
    signal?: AbortSignal;
  },
  outputFile: string
): RunSpec {
  return {
    command: process.execPath,
    args: [
      resolveVitestBin(),
      "run",
      "--root",
      path.resolve(input.testsDir),
      "--reporter=json",
      "--outputFile",
      outputFile
    ],
    cwd: path.resolve(input.testsDir),
    env: createVitestEnv(path.resolve(input.cloneDir), path.resolve(input.oracleDir)),
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
    killProcessGroup: true
  };
}

function resolveVitestBin(): string {
  const packageJsonPath = require.resolve("vitest/package.json");
  return path.join(path.dirname(path.dirname(packageJsonPath)), ".bin", "vitest");
}

function createVitestEnv(cloneDir: string, oracleDir: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );

  env.CLONE_DIR = cloneDir;
  env.ORACLE_DIR = oracleDir;
  return env;
}

async function waitForVitest(
  handle: RunHandle,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<{ exitCode: number }> {
  if (signal?.aborted) {
    await terminateRunHandle(handle);
    throw abortReason(signal);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelling = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const cancel = (reason: Error): void => {
      if (settled || cancelling) {
        return;
      }
      cancelling = true;
      void terminateRunHandle(handle).then(
        () => {
          finish(() => reject(reason));
        },
        () => {
          finish(() => reject(reason));
        }
      );
    };

    function onAbort(): void {
      if (signal === undefined) {
        return;
      }
      cancel(abortReason(signal));
    }

    timeout = setTimeout(() => {
      cancel(new VitestTimeoutError(`Vitest timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    void handle.result.then(
      (result) => {
        if (cancelling) {
          return;
        }
        finish(() => resolve({ exitCode: result.exitCode }));
      },
      (error: unknown) => {
        if (cancelling) {
          return;
        }
        finish(() => reject(error));
      }
    );
  });
}

function mapVitestCases(parsed: unknown, testsDir: string): CaseResult[] {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as VitestJson).testResults)
  ) {
    throw new VitestError("Malformed vitest JSON output: expected testResults array");
  }

  return (parsed as VitestJson).testResults.flatMap((fileResult) => {
    const fileName = formatFileName(fileResult.name, testsDir);
    const assertions: VitestAssertion[] = Array.isArray(fileResult.assertionResults)
      ? fileResult.assertionResults
      : [];

    return assertions.map((assertion) => mapAssertion(fileName, assertion));
  });
}

function mapAssertion(fileName: string, assertion: VitestAssertion): CaseResult {
  const passed = assertion.state === "pass" || assertion.status === "passed";
  const message = failureMessage(assertion);
  if (typeof assertion.duration === "number" && !Number.isFinite(assertion.duration)) {
    throw new VitestError("Malformed vitest JSON output: case duration must be finite");
  }

  return {
    name: formatCaseName(fileName, assertion),
    passed,
    durationMs: typeof assertion.duration === "number" ? assertion.duration : 0,
    ...(passed || message === undefined ? {} : { message })
  };
}

function assertValidTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new VitestError("Vitest timeout must be a finite non-negative number.");
  }
}

function formatFileName(fileName: unknown, testsDir: string): string {
  if (typeof fileName !== "string" || fileName.length === 0) {
    return "<unknown>";
  }

  const relative = path.relative(testsDir, fileName);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    return normalizePath(fileName);
  }

  return normalizePath(relative);
}

function formatCaseName(fileName: string, assertion: VitestAssertion): string {
  const ancestors = Array.isArray(assertion.ancestorTitles)
    ? assertion.ancestorTitles.filter(
        (title): title is string => typeof title === "string" && title.length > 0
      )
    : [];
  const title = typeof assertion.title === "string" ? assertion.title : undefined;
  const fullName = typeof assertion.fullName === "string" ? assertion.fullName : undefined;
  const nameParts =
    title === undefined ? (fullName === undefined ? [] : [fullName]) : [...ancestors, title];

  return [fileName, ...nameParts].join(" > ");
}

function failureMessage(assertion: VitestAssertion): string | undefined {
  if (Array.isArray(assertion.failureMessages) && assertion.failureMessages.length > 0) {
    return assertion.failureMessages
      .filter((message): message is string => typeof message === "string")
      .join("\n");
  }

  return typeof assertion.message === "string" && assertion.message.length > 0
    ? assertion.message
    : undefined;
}

function normalizePath(fileName: string): string {
  return fileName.split(path.sep).join("/");
}

function drainStream(stream: NodeJS.ReadableStream | null): Promise<void> {
  if (stream === null) {
    return Promise.resolve();
  }

  stream.resume();
  return new Promise((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Vitest run aborted");
}


interface VitestJson {
  testResults: VitestFileResult[];
}

interface VitestFileResult {
  name?: unknown;
  assertionResults?: unknown;
}

interface VitestAssertion {
  ancestorTitles?: unknown;
  duration?: unknown;
  failureMessages?: unknown;
  fullName?: unknown;
  message?: unknown;
  state?: unknown;
  status?: unknown;
  title?: unknown;
}
