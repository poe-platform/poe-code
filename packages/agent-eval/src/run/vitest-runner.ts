import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createHostRunner,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";

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
  const handle = runner.exec(createVitestRunSpec(input, outputFile));
  const stdout = drainStream(handle.stdout).catch(() => undefined);
  const stderr = drainStream(handle.stderr).catch(() => undefined);

  try {
    const runResult = await waitForVitest(handle, timeoutMs, input.signal);
    await Promise.all([stdout, stderr]);
    const raw = await readFile(outputFile, "utf8");
    const cases = mapVitestCases(JSON.parse(raw), path.resolve(input.testsDir));
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
    killQuietly(handle);
    await unlink(outputFile).catch(() => undefined);
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
    signal: input.signal
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
    killQuietly(handle);
    throw abortReason(signal);
  }

  let timeout: NodeJS.Timeout | null = null;
  let removeAbortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      killQuietly(handle);
      reject(new VitestTimeoutError(`Vitest timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const abortPromise =
    signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            killQuietly(handle);
            reject(abortReason(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        });

  try {
    return await Promise.race([
      handle.result.then((result) => ({ exitCode: result.exitCode })),
      timeoutPromise,
      ...(abortPromise === undefined ? [] : [abortPromise])
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    removeAbortListener?.();
  }
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

function killQuietly(handle: RunHandle): void {
  try {
    handle.kill("SIGTERM");
  } catch {
    // Best effort cleanup after a timeout or abort.
  }
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
