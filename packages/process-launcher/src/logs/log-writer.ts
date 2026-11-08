import path from "node:path";
import * as nodeFs from "node:fs/promises";
import { hasOwnErrorCode } from "../errors.js";
import type { LauncherFileSystem, LogWriter } from "../types.js";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function getCurrentLogPath(logDir: string, stream: "stdout" | "stderr"): string {
  return path.join(logDir, `${stream}.log`);
}

function getRotatedLogPath(logDir: string, stream: "stdout" | "stderr", index: number): string {
  return path.join(logDir, `${stream}.${index}.log`);
}

async function isFile(fs: LauncherFileSystem, filePath: string): Promise<boolean> {
  try {
    await assertPathHasNoSymbolicLinks(fs, filePath);
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function removeIfExists(fs: LauncherFileSystem, filePath: string): Promise<void> {
  if (!(await isFile(fs, filePath))) {
    return;
  }

  await fs.rm(filePath, { force: true });
}

async function moveIfExists(
  fs: LauncherFileSystem,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  if (!(await isFile(fs, sourcePath))) {
    return;
  }

  await assertPathHasNoSymbolicLinks(fs, destinationPath);
  await fs.rename(sourcePath, destinationPath);
}

function getRotatedLogIndex(fileName: string, stream: "stdout" | "stderr"): number | null {
  const prefix = `${stream}.`;
  const suffix = ".log";

  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return null;
  }

  const rawIndex = fileName.slice(prefix.length, -suffix.length);
  const index = Number.parseInt(rawIndex, 10);

  if (!Number.isInteger(index) || index < 1 || `${index}` !== rawIndex) {
    return null;
  }

  return index;
}

async function removeAllStreamLogs(
  fs: LauncherFileSystem,
  logDir: string,
  stream: "stdout" | "stderr"
): Promise<void> {
  await removeIfExists(fs, getCurrentLogPath(logDir, stream));

  try {
    const fileNames = await fs.readdir(logDir);

    for (const fileName of fileNames) {
      if (getRotatedLogIndex(fileName, stream) === null) {
        continue;
      }

      await fs.rm(path.join(logDir, fileName), { force: true });
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

function getLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split("\n");

  if (content.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

export function createLogWriter(
  logDir: string,
  retainCount: number,
  fs: LauncherFileSystem = nodeFs as unknown as LauncherFileSystem
): LogWriter {
  if (!Number.isFinite(retainCount) || !Number.isInteger(retainCount) || retainCount < 0) {
    throw new Error("retainCount must be a finite non-negative integer");
  }
  const maxRetainedRuns = retainCount;
  let operationQueue = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function writeNow(line: string, stream: "stdout" | "stderr"): Promise<void> {
    await assertPathHasNoSymbolicLinks(fs, logDir);
    await fs.mkdir(logDir, { recursive: true });
    await assertPathHasNoSymbolicLinks(fs, logDir);
    const currentPath = getCurrentLogPath(logDir, stream);
    await assertPathHasNoSymbolicLinks(fs, currentPath);
    await fs.appendFile(currentPath, `${line}\n`);
  }

  function write(line: string, stream: "stdout" | "stderr"): Promise<void> {
    return enqueue(() => writeNow(line, stream));
  }

  async function rotateStream(stream: "stdout" | "stderr"): Promise<void> {
    const currentPath = getCurrentLogPath(logDir, stream);

    if (maxRetainedRuns === 0) {
      await removeAllStreamLogs(fs, logDir, stream);
      return;
    }

    await removeIfExists(fs, getRotatedLogPath(logDir, stream, maxRetainedRuns));

    for (let index = maxRetainedRuns - 1; index >= 1; index -= 1) {
      await moveIfExists(
        fs,
        getRotatedLogPath(logDir, stream, index),
        getRotatedLogPath(logDir, stream, index + 1)
      );
    }

    await moveIfExists(fs, currentPath, getRotatedLogPath(logDir, stream, 1));
  }

  async function rotateNow(): Promise<void> {
    await assertPathHasNoSymbolicLinks(fs, logDir);
    const priorLogs = await captureLogs(fs, logDir);
    try {
      await rotateStream("stdout");
      await rotateStream("stderr");
    } catch (error) {
      await restoreLogs(fs, logDir, priorLogs);
      throw error;
    }
  }

  function rotate(): Promise<void> {
    return enqueue(() => rotateNow());
  }

  async function tailNow(stream: "stdout" | "stderr", lines = 50): Promise<string[]> {
    if (!Number.isFinite(lines) || !Number.isInteger(lines) || lines < 0) {
      throw new Error("lines must be a finite non-negative integer");
    }
    try {
      await assertPathHasNoSymbolicLinks(fs, logDir);
      const currentPath = getCurrentLogPath(logDir, stream);
      await assertPathHasNoSymbolicLinks(fs, currentPath);
      const content = await fs.readFile(currentPath, "utf8");
      const allLines = getLines(content);
      if (lines === 0) {
        return [];
      }

      return allLines.slice(-lines);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }

  function tail(stream: "stdout" | "stderr", lines = 50): Promise<string[]> {
    return enqueue(() => tailNow(stream, lines));
  }

  function close(): void {}

  return { write, rotate, tail, close };
}

async function captureLogs(fs: LauncherFileSystem, logDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(logDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return snapshot;
    }
    throw error;
  }

  for (const fileName of fileNames) {
    if (
      fileName !== "stdout.log" &&
      fileName !== "stderr.log" &&
      getRotatedLogIndex(fileName, "stdout") === null &&
      getRotatedLogIndex(fileName, "stderr") === null
    ) {
      continue;
    }
    const filePath = path.join(logDir, fileName);
    await assertPathHasNoSymbolicLinks(fs, filePath);
    snapshot.set(filePath, await fs.readFile(filePath, "utf8"));
  }

  return snapshot;
}

async function restoreLogs(
  fs: LauncherFileSystem,
  logDir: string,
  snapshot: Map<string, string>
): Promise<void> {
  let fileNames: string[] = [];
  try {
    fileNames = await fs.readdir(logDir);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  for (const fileName of fileNames) {
    const filePath = path.join(logDir, fileName);
    const managed =
      fileName === "stdout.log" ||
      fileName === "stderr.log" ||
      getRotatedLogIndex(fileName, "stdout") !== null ||
      getRotatedLogIndex(fileName, "stderr") !== null;
    if (managed && !snapshot.has(filePath)) {
      await assertPathHasNoSymbolicLinks(fs, filePath);
      await fs.rm(filePath, { force: true });
    }
  }

  for (const [filePath, content] of snapshot) {
    await assertPathHasNoSymbolicLinks(fs, filePath);
    await fs.writeFile(filePath, content);
  }
}
