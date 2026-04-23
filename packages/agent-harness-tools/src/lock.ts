import * as fsPromises from "node:fs/promises";

interface LockFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

interface LockFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<LockFileStat>;
}

export interface LockOptions {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  staleMs?: number;
  fs?: LockFileSystem;
  signal?: AbortSignal;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function backoff(attempt: number, minTimeout: number, maxTimeout: number): number {
  const delay = Math.min(maxTimeout, minTimeout * Math.pow(2, attempt));
  return delay + Math.random() * delay * 0.1;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function createDefaultFs(): LockFileSystem {
  return {
    mkdir: async (path, options) => {
      await fsPromises.mkdir(path, options);
    },
    rmdir: fsPromises.rmdir,
    stat: async (path) => {
      const stat = await fsPromises.stat(path);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    }
  };
}

async function removeLockDirectory(fs: LockFileSystem, lockPath: string): Promise<void> {
  try {
    await fs.rmdir(lockPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

export async function lockWorkflow(
  docPath: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const fs = options.fs ?? createDefaultFs();
  const retries = options.retries ?? 20;
  const minTimeout = options.minTimeout ?? 25;
  const maxTimeout = options.maxTimeout ?? 250;
  const staleMs = options.staleMs ?? 30_000;
  const lockPath = `${docPath}.lock`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(options.signal);

    try {
      await fs.mkdir(lockPath);
      let released = false;

      return async () => {
        if (released) {
          return;
        }

        released = true;
        await removeLockDirectory(fs, lockPath);
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }

      let stat: LockFileStat;
      try {
        stat = await fs.stat(lockPath);
      } catch (statError) {
        if (hasErrorCode(statError, "ENOENT")) {
          continue;
        }

        throw statError;
      }

      if (Date.now() - stat.mtimeMs > staleMs) {
        await removeLockDirectory(fs, lockPath);
        continue;
      }

      if (attempt < retries) {
        await sleep(backoff(attempt, minTimeout, maxTimeout), options.signal);
      }
    }
  }

  throw new Error(`Failed to acquire lock on "${docPath}".`);
}
