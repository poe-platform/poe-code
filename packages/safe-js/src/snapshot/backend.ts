import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getOwnErrorCode, hasOwnErrorCode } from "../error-codes.js";
import type { SafeJSSnapshot } from "../restore.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";

export type Snapshot = SafeJSSnapshot;

export interface SnapshotBackend {
  read(): Promise<Snapshot | undefined>;
  write(snapshot: Snapshot): Promise<void>;
  remove(): Promise<void>;
}

export type FileSnapshotBackendOptions = {
  writeMaxAttempts?: number;
  writeRetryDelayMs?: number;
};

const DEFAULT_WRITE_MAX_ATTEMPTS = 3;
const DEFAULT_WRITE_RETRY_DELAY_MS = 100;
const LOCKED_FILE_ERROR_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const pendingOperations = new Map<string, Promise<void>>();

export class FileSnapshotBackend implements SnapshotBackend {
  readonly #writeMaxAttempts: number;
  readonly #writeRetryDelayMs: number;

  constructor(
    readonly path: string,
    options: FileSnapshotBackendOptions = {}
  ) {
    this.#writeMaxAttempts = options.writeMaxAttempts ?? DEFAULT_WRITE_MAX_ATTEMPTS;
    this.#writeRetryDelayMs = options.writeRetryDelayMs ?? DEFAULT_WRITE_RETRY_DELAY_MS;
  }

  async read(): Promise<Snapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Snapshot;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return undefined;
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse snapshot at ${this.path}: ${error.message}`);
      }

      throw error;
    }
  }

  async write(snapshot: Snapshot): Promise<void> {
    await enqueueOperation(this.path, () =>
      writeSnapshotAtomically(this.path, snapshot, {
        maxAttempts: this.#writeMaxAttempts,
        retryDelayMs: this.#writeRetryDelayMs
      })
    );
  }

  async remove(): Promise<void> {
    await enqueueOperation(this.path, async () => {
      try {
        await unlink(this.path);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw error;
        }
      }
    });
  }
}

async function writeSnapshotAtomically(
  snapshotPath: string,
  snapshot: Snapshot,
  options: {
    maxAttempts: number;
    retryDelayMs: number;
  }
): Promise<void> {
  const parentPath = dirname(snapshotPath);
  const contents = serializeSafeJSSnapshot(snapshot);

  await assertParentDirectoryExists(snapshotPath, parentPath);

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;
      await writeSnapshotOnce(temporaryPath, snapshotPath, contents);
      return;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        if (attempt === options.maxAttempts) {
          throw new Error(
            `Failed to write snapshot at ${snapshotPath} after ${options.maxAttempts} attempts: temporary path already exists`,
            {
              cause: error
            }
          );
        }

        continue;
      }

      if (!isLockedFileError(error)) {
        throw error;
      }

      if (attempt === options.maxAttempts) {
        throw new Error(
          `Failed to write snapshot at ${snapshotPath} after ${options.maxAttempts} attempts: file is locked (${getOwnErrorCode(error)})`,
          {
            cause: error
          }
        );
      }

      await delay(options.retryDelayMs);
    }
  }
}

async function assertParentDirectoryExists(
  snapshotPath: string,
  parentPath: string
): Promise<void> {
  try {
    const parent = await stat(parentPath);
    if (!parent.isDirectory()) {
      throw new Error(
        `Cannot write snapshot at ${snapshotPath}: parent path ${parentPath} is not a directory`
      );
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Error(
        `Cannot write snapshot at ${snapshotPath}: parent directory ${parentPath} does not exist`,
        {
          cause: error
        }
      );
    }

    throw error;
  }
}

async function writeSnapshotOnce(
  temporaryPath: string,
  snapshotPath: string,
  contents: string
): Promise<void> {
  let temporaryCreated = false;
  let renamed = false;
  try {
    try {
      await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
      temporaryCreated = true;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        await removeTemporarySnapshot(temporaryPath).catch(() => undefined);
      }
      throw error;
    }
    await rename(temporaryPath, snapshotPath);
    renamed = true;
  } finally {
    if (temporaryCreated && !renamed) {
      await removeTemporarySnapshot(temporaryPath).catch(() => undefined);
    }
  }
}

async function enqueueOperation(path: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingOperations.get(path) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  const queued = pending.catch(() => undefined);
  pendingOperations.set(path, queued);
  try {
    await pending;
  } finally {
    if (pendingOperations.get(path) === queued) {
      pendingOperations.delete(path);
    }
  }
}

async function removeTemporarySnapshot(temporaryPath: string): Promise<void> {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function delay(ms: number): Promise<void> {
  if (ms === 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

function isLockedFileError(error: unknown): boolean {
  const code = getOwnErrorCode(error);
  return code !== undefined && LOCKED_FILE_ERROR_CODES.has(code);
}
