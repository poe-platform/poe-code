import path from "node:path";
import * as nodeFs from "node:fs/promises";
import type { LauncherFileSystem, LogWriter } from "../types.js";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function getCurrentLogPath(logDir: string, stream: "stdout" | "stderr"): string {
  return path.join(logDir, `${stream}.log`);
}

function getRotatedLogPath(logDir: string, stream: "stdout" | "stderr", index: number): string {
  return path.join(logDir, `${stream}.${index}.log`);
}

async function isFile(fs: LauncherFileSystem, filePath: string): Promise<boolean> {
  try {
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

  const content = await fs.readFile(sourcePath, "utf8");
  await fs.writeFile(destinationPath, content);
  await fs.rm(sourcePath, { force: true });
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

  async function write(line: string, stream: "stdout" | "stderr"): Promise<void> {
    await assertPathHasNoSymbolicLinks(fs, logDir);
    await fs.mkdir(logDir, { recursive: true });
    await assertPathHasNoSymbolicLinks(fs, logDir);
    await fs.appendFile(getCurrentLogPath(logDir, stream), `${line}\n`);
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

  async function rotate(): Promise<void> {
    await assertPathHasNoSymbolicLinks(fs, logDir);
    await rotateStream("stdout");
    await rotateStream("stderr");
  }

  async function tail(stream: "stdout" | "stderr", lines = 50): Promise<string[]> {
    if (!Number.isFinite(lines) || !Number.isInteger(lines) || lines < 0) {
      throw new Error("lines must be a finite non-negative integer");
    }
    try {
      await assertPathHasNoSymbolicLinks(fs, logDir);
      const content = await fs.readFile(getCurrentLogPath(logDir, stream), "utf8");
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

  function close(): void {}

  return { write, rotate, tail, close };
}
