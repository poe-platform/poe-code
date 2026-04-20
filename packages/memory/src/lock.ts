import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { MEMORY_LOCK_RELPATH } from "./paths.js";
import type { MemoryRoot } from "./types.js";

interface LockFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  unlink(path: string): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options?: {
      encoding?: BufferEncoding;
      flag?: string;
    }
  ): Promise<void>;
}

export interface LockOptions {
  fs?: LockFileSystem;
  isPidRunning?: (pid: number) => boolean;
  maxTimeoutMs?: number;
  minTimeoutMs?: number;
  pid?: number;
  retries?: number;
}

function createDefaultFs(): LockFileSystem {
  return {
    readFile: (filePath, encoding) => fsPromises.readFile(filePath, encoding),
    unlink: fsPromises.unlink,
    writeFile: (filePath, data, options) => fsPromises.writeFile(filePath, data, options)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function lockDelay(attempt: number, minTimeoutMs: number, maxTimeoutMs: number): number {
  return Math.min(maxTimeoutMs, minTimeoutMs * Math.pow(2, attempt));
}

function parsePid(input: string): number | undefined {
  const value = input.trim();
  if (value.length === 0) {
    return undefined;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return undefined;
    }
  }

  const pid = Number.parseInt(value, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

async function removeLockFile(fs: LockFileSystem, lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function readLockPid(fs: LockFileSystem, lockPath: string): Promise<number | undefined | null> {
  try {
    return parsePid(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

export async function withLock<TResult>(
  root: MemoryRoot,
  run: () => Promise<TResult> | TResult,
  options: LockOptions = {}
): Promise<TResult> {
  const fs = options.fs ?? createDefaultFs();
  const lockPath = path.join(root, MEMORY_LOCK_RELPATH);
  const pid = options.pid ?? process.pid;
  const retries = options.retries ?? 20;
  const minTimeoutMs = options.minTimeoutMs ?? 25;
  const maxTimeoutMs = options.maxTimeoutMs ?? 250;
  const pidIsRunning = options.isPidRunning ?? isPidRunning;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fs.writeFile(lockPath, `${pid}\n`, { encoding: "utf8", flag: "wx" });

      try {
        return await run();
      } finally {
        await removeLockFile(fs, lockPath);
      }
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    const existingPid = await readLockPid(fs, lockPath);
    if (existingPid === null) {
      continue;
    }

    if (existingPid === undefined || !pidIsRunning(existingPid)) {
      await removeLockFile(fs, lockPath);
      continue;
    }

    if (attempt < retries) {
      await sleep(lockDelay(attempt, minTimeoutMs, maxTimeoutMs));
    }
  }

  throw new Error(`Failed to acquire memory lock at "${lockPath}".`);
}
