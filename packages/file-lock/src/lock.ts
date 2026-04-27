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
  readFile?(path: string, encoding: BufferEncoding): Promise<string>;
  unlink(path: string): Promise<void>;
}

export interface FileLockOptions {
  staleMs?: number;
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  fs?: FileLockFs;
  isPidRunning?: (pid: number) => boolean;
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

function hasAnyErrorCode(error: unknown, codes: readonly string[]): boolean {
  return codes.some((code) => hasErrorCode(error, code));
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

function createDefaultFs(): FileLockFs {
  return {
    open: (path, flags) => fsPromises.open(path, flags),
    readFile: (path, encoding) => fsPromises.readFile(path, encoding),
    stat: fsPromises.stat,
    unlink: fsPromises.unlink
  };
}

async function removeLockFile(
  fs: FileLockFs,
  lockPath: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    throwIfAborted(signal);

    try {
      await fs.unlink(lockPath);
      return;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }

      if (!hasAnyErrorCode(error, ["EPERM", "EBUSY"]) || attempt === 4) {
        throw error;
      }
    }

    await sleep(25 * 2 ** attempt, signal);
  }
}

type LockMetadata = {
  host: string;
  pid: number;
};

function parseLockMetadata(content: string): LockMetadata | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || !("host" in parsed) || !("pid" in parsed)) {
      return undefined;
    }

    const { host, pid } = parsed;
    if (typeof host === "string" && typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) {
      return {
        host,
        pid
      };
    }
  } catch (ignoredError) {
    void ignoredError;
  }

  return undefined;
}

async function readLockMetadata(
  fs: FileLockFs,
  lockPath: string
): Promise<LockMetadata | undefined | null> {
  if (!fs.readFile) {
    return undefined;
  }

  try {
    return parseLockMetadata(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }

    return undefined;
  }
}

async function shouldReclaimLock(options: {
  fs: FileLockFs;
  isPidRunning: (pid: number) => boolean;
  lockPath: string;
  staleMs: number;
  stat: Awaited<ReturnType<FileLockFs["stat"]>>;
}): Promise<boolean | "missing"> {
  const metadata = await readLockMetadata(options.fs, options.lockPath);
  if (metadata === null) {
    return "missing";
  }

  if (metadata?.host === os.hostname()) {
    return !options.isPidRunning(metadata.pid);
  }

  return Date.now() - options.stat.mtimeMs > options.staleMs;
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
  const staleMs = options.staleMs ?? 1_000;
  const pidIsRunning = options.isPidRunning ?? isPidRunning;
  const lockPath = `${filePath}.lock`;

  let attempt = 0;

  while (attempt <= retries) {
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
        await removeLockFile(fs, lockPath, options.signal);
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

    const reclaimLock = await shouldReclaimLock({
      fs,
      isPidRunning: pidIsRunning,
      lockPath,
      staleMs,
      stat
    });
    if (reclaimLock === "missing") {
      continue;
    }

    if (reclaimLock) {
      await removeLockFile(fs, lockPath, options.signal);
      continue;
    }

    if (attempt >= retries) {
      break;
    }

    await sleep(backoff(attempt, minTimeout, maxTimeout), options.signal);
    attempt += 1;
  }

  throw new LockTimeoutError(`Failed to acquire lock on "${filePath}".`);
}
