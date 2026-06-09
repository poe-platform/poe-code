import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";
import type { CheatReport, EvalRunResult, SpawnEvent } from "../types.js";
import { assertRunArtifactPath } from "./artifact-path.js";
import type { NormalizedTrace } from "./trace/types.js";

const TEMP_WRITE_MAX_ATTEMPTS = 3;

export async function writeRunArtifacts(
  runDir: string,
  parts: {
    result: EvalRunResult;
    events: readonly SpawnEvent[];
    trace: NormalizedTrace;
    cheatReport: CheatReport;
    judge?: unknown;
    planMd: string;
    evalYaml: string;
  }
): Promise<void> {
  await writeRunEvidence(runDir, parts);
  await writeRunCompletion(runDir, parts);
}

export async function writeRunEvidence(
  runDir: string,
  parts: {
    events: readonly SpawnEvent[];
    trace: NormalizedTrace;
    cheatReport: CheatReport;
    planMd: string;
    evalYaml: string;
  }
): Promise<void> {
  await assertSafeRunDirectory(runDir);
  await mkdir(runDir, { recursive: true });

  const filePaths = [
    path.join(runDir, "events.jsonl"),
    path.join(runDir, "trace.json"),
    path.join(runDir, "cheat-report.json"),
    path.join(runDir, "plan.md"),
    path.join(runDir, "eval.yaml")
  ];
  const priorContents = await Promise.all(filePaths.map((filePath) => readExistingFile(filePath)));
  const committedPaths: number[] = [];

  try {
    await atomicWrite(filePaths[0], formatEventsJsonl(parts.events));
    committedPaths.push(0);
    await atomicWrite(filePaths[1], `${JSON.stringify(parts.trace, null, 2)}\n`);
    committedPaths.push(1);
    await atomicWrite(filePaths[2], `${JSON.stringify(parts.cheatReport, null, 2)}\n`);
    committedPaths.push(2);
    await atomicWrite(filePaths[3], parts.planMd);
    committedPaths.push(3);
    await atomicWrite(filePaths[4], parts.evalYaml);
    committedPaths.push(4);
  } catch (error) {
    await Promise.all(
      committedPaths.map((index) => restoreFile(filePaths[index], priorContents[index]).catch(() => undefined))
    );
    throw error;
  }
}

async function assertSafeRunDirectory(runDir: string): Promise<void> {
  try {
    const runStat = await lstat(runDir);
    if (runStat.isSymbolicLink()) {
      throw new Error("Run artifact directory must not be a symbolic link.");
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
  await assertRunArtifactPath(path.parse(path.resolve(runDir)).root, path.dirname(runDir));
}

export async function writeRunCompletion(
  runDir: string,
  parts: { result: EvalRunResult; judge?: unknown }
): Promise<void> {
  const resultPath = path.join(runDir, "result.json");
  const priorResult = await readExistingFile(resultPath);
  await writeRunResult(runDir, parts.result);
  try {
    if (parts.judge !== undefined) {
      await atomicWrite(path.join(runDir, "judge.json"), `${JSON.stringify(parts.judge, null, 2)}\n`);
    }
  } catch (error) {
    await restoreFile(resultPath, priorResult).catch(() => undefined);
    throw error;
  }
}

export async function writeRunResult(runDir: string, result: EvalRunResult): Promise<void> {
  await atomicWrite(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  for (let attempt = 1; attempt <= TEMP_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      await writeTempThenRename(tempPath, filePath, content);
      return;
    } catch (error) {
      if (isExistingPath(error) && attempt < TEMP_WRITE_MAX_ATTEMPTS) {
        continue;
      }

      throw error;
    }
  }
}

async function writeTempThenRename(
  tempPath: string,
  filePath: string,
  content: string
): Promise<void> {
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

function formatEventsJsonl(events: readonly SpawnEvent[]): string {
  if (events.length === 0) {
    return "";
  }
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function isMissingPath(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR");
}

function isExistingPath(error: unknown): boolean {
  return hasErrorCode(error, "EEXIST");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

async function readExistingFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(filePath: string, priorContent: string | undefined): Promise<void> {
  if (priorContent === undefined) {
    await rm(filePath, { force: true });
    return;
  }

  await atomicWrite(filePath, priorContent);
}
