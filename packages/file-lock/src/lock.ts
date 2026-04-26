import * as fsPromises from "node:fs/promises";
import * as os from "node:os";

export interface FileLockFs {
  open(path: string, flags: string): Promise<{
    close(): Promise<void>;
    writeFile(
      data: string,
      options?: BufferEncoding | { encoding?: BufferEncoding }
    ): Promise<void>;
  }>;
  stat(path: string): Promise<{
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
}

export interface FileLockOptions {
  staleMs?: number;
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  fs?: FileLockFs;
  signal?: AbortSignal;
}

export type ReleaseLock = () => Promise<void>;

export class LockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockTimeoutError";
  }
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
  const delay = Math.min(maxTimeout, minTimeout * 2 ** attempt);
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

function createDefaultFs(): FileLockFs {
  return {
    open: (path, flags) => fsPromises.open(path, flags),
    stat: fsPromises.stat,
    unlink: fsPromises.unlink
  };
}

async function removeLockFile(fs: FileLockFs, lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function writeLockMetadata(handle: Awaited<ReturnType<FileLockFs["open"]>>): Promise<void> {
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() }),
      { encoding: "utf8" }
    );
  } catch (ignoredError) {
    void ignoredError;
  }
  try {
    await handle.close();
  } catch (ignoredError) {
    void ignoredError;
  }
}

export async function acquireFileLock(
  filePath: string,
  options: FileLockOptions = {}
): Promise<ReleaseLock> {
  const fs = options.fs ?? createDefaultFs();
  const retries = options.retries ?? 20;
  const minTimeout = options.minTimeout ?? 25;
  const maxTimeout = options.maxTimeout ?? 250;
  const staleMs = options.staleMs ?? 30_000;
  const lockPath = `${filePath}.lock`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(options.signal);

    try {
      const handle = await fs.open(lockPath, "wx");
      await writeLockMetadata(handle);
      let released = false;

      return async () => {
        if (released) {
          return;
        }

        released = true;
        await removeLockFile(fs, lockPath);
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    let stat: Awaited<ReturnType<FileLockFs["stat"]>>;
    try {
      stat = await fs.stat(lockPath);
    } catch (statError) {
      if (hasErrorCode(statError, "ENOENT")) {
        continue;
      }

      throw statError;
    }

    if (Date.now() - stat.mtimeMs > staleMs) {
      await removeLockFile(fs, lockPath);
      continue;
    }

    if (attempt < retries) {
      await sleep(backoff(attempt, minTimeout, maxTimeout), options.signal);
    }
  }

  throw new LockTimeoutError(`Failed to acquire lock on "${filePath}".`);
}
