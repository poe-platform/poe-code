import * as fsPromises from "node:fs/promises";
import type { PipelineFileSystem } from "../types.js";

type LockFs = Pick<PipelineFileSystem, "mkdir" | "rmdir" | "stat">;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number, min: number, max: number): number {
  const delay = Math.min(max, min * Math.pow(2, attempt));
  return delay + Math.random() * delay * 0.1;
}

function createDefaultFs(): LockFs {
  return {
    mkdir: async (filePath) => {
      await fsPromises.mkdir(filePath);
    },
    rmdir: fsPromises.rmdir,
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    }
  };
}

export async function lockFile(
  filePath: string,
  options: {
    fs?: LockFs;
    retries?: number;
    minTimeout?: number;
    maxTimeout?: number;
    staleMs?: number;
  } = {}
): Promise<() => Promise<void>> {
  const fs = options.fs ?? createDefaultFs();
  const retries = options.retries ?? 20;
  const minTimeout = options.minTimeout ?? 25;
  const maxTimeout = options.maxTimeout ?? 250;
  const staleMs = options.staleMs ?? 30_000;
  const lockPath = `${filePath}.lock`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        try {
          await fs.rmdir(lockPath);
        } catch (error) {
          if (
            !error ||
            typeof error !== "object" ||
            !("code" in error) ||
            (error as { code?: unknown }).code !== "ENOENT"
          ) {
            throw error;
          }
        }
      };
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "EEXIST"
      ) {
        throw error;
      }

      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > staleMs) {
        await fs.rmdir(lockPath);
        continue;
      }

      if (attempt < retries) {
        await sleep(backoff(attempt, minTimeout, maxTimeout));
      }
    }
  }

  throw new Error(`Failed to acquire lock on "${filePath}".`);
}
