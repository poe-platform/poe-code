import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentScriptSnapshot } from "../restore.js";
import { serializeAgentScriptSnapshot } from "./dump-format.js";

export type Snapshot = AgentScriptSnapshot;

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

export class FileSnapshotBackend implements SnapshotBackend {
  #pendingWrite = Promise.resolve();
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
    const write = this.#pendingWrite
      .catch(() => undefined)
      .then(() =>
        writeSnapshotAtomically(this.path, snapshot, {
          maxAttempts: this.#writeMaxAttempts,
          retryDelayMs: this.#writeRetryDelayMs
        })
      );
    this.#pendingWrite = write.catch(() => undefined);
    await write;
  }

  async remove(): Promise<void> {
    await this.#pendingWrite;
    try {
      await unlink(this.path);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
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
  const temporaryPath = `${snapshotPath}.tmp`;
  const parentPath = dirname(snapshotPath);
  const contents = serializeAgentScriptSnapshot(snapshot);

  await assertParentDirectoryExists(snapshotPath, parentPath);

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await writeSnapshotOnce(temporaryPath, snapshotPath, contents);
      return;
    } catch (error) {
      if (!isLockedFileError(error)) {
        throw error;
      }

      if (attempt === options.maxAttempts) {
        throw new Error(
          `Failed to write snapshot at ${snapshotPath} after ${options.maxAttempts} attempts: file is locked (${getErrorCode(error)})`,
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
  let renamed = false;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, snapshotPath);
    renamed = true;
  } finally {
    if (!renamed) {
      await removeTemporarySnapshot(temporaryPath);
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
  return getErrorCode(error) === code;
}

function isLockedFileError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && LOCKED_FILE_ERROR_CODES.has(code);
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}
