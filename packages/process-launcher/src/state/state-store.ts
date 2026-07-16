import path from "node:path";
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import type { LauncherFileSystem, ProcessState, StateStore } from "../types.js";
import { hasOwnErrorCode } from "../errors.js";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";
import { assertValidManagedProcessId } from "../process-id.js";

export const REMOVED_STATE_PREFIX = ".state-removed-";

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function resolveProcessDir(stateDir: string, id: string): string {
  assertValidManagedProcessId(id);
  return path.join(stateDir, id);
}

async function removeDirectory(fs: LauncherFileSystem, directoryPath: string): Promise<void> {
  try {
    if ((await fs.lstat(directoryPath)).isSymbolicLink()) {
      throw new Error(`Refusing to remove managed process through symbolic link: ${directoryPath}`);
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  let entries: string[];

  try {
    entries = await fs.readdir(directoryPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry);
    const stat = await fs.stat(entryPath);

    if (stat.isFile()) {
      await fs.rm(entryPath, { force: true });
      continue;
    }

    await removeDirectory(fs, entryPath);
  }

  const fsWithDirectoryRemoval = fs as LauncherFileSystem & {
    rmdir?: (path: string) => Promise<void>;
  };

  if (typeof fsWithDirectoryRemoval.rmdir === "function") {
    await fsWithDirectoryRemoval.rmdir(directoryPath);
    return;
  }

  await fs.rm(directoryPath, { force: true, recursive: true });
}

async function assertRemovalTreeHasNoSymbolicLinks(
  fs: LauncherFileSystem,
  targetPath: string
): Promise<void> {
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`Refusing to remove managed process through symbolic link: ${targetPath}`);
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  if ((await fs.stat(targetPath)).isFile()) {
    return;
  }

  for (const entry of await fs.readdir(targetPath)) {
    await assertRemovalTreeHasNoSymbolicLinks(fs, path.join(targetPath, entry));
  }
}

export function createStateStore(
  stateDir: string,
  fs: LauncherFileSystem = nodeFs as unknown as LauncherFileSystem
): StateStore {
  async function read(id: string): Promise<ProcessState | null> {
    const statePath = path.join(resolveProcessDir(stateDir, id), "state.json");

    try {
      await assertPathHasNoSymbolicLinks(fs, statePath);
      const content = await fs.readFile(statePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      return assertValidProcessStateDocument(parsed, id);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async function write(id: string, state: ProcessState): Promise<void> {
    const processDir = resolveProcessDir(stateDir, id);
    const statePath = path.join(processDir, "state.json");
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    await assertPathHasNoSymbolicLinks(fs, statePath);
    await fs.mkdir(processDir, { recursive: true });
    await assertPathHasNoSymbolicLinks(fs, statePath);
    await assertPathHasNoSymbolicLinks(fs, temporaryPath);

    let temporaryCreated = false;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      temporaryCreated = true;
      await assertPathHasNoSymbolicLinks(fs, statePath);
      await fs.rename(temporaryPath, statePath);
    } catch (error) {
      if (temporaryCreated || !isAlreadyExistsError(error)) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async function list(): Promise<ProcessState[]> {
    let entries: string[];

    try {
      entries = await fs.readdir(stateDir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    const states: ProcessState[] = [];

    for (const entry of [...entries].sort()) {
      if (entry.startsWith(REMOVED_STATE_PREFIX)) {
        continue;
      }
      const entryPath = path.join(stateDir, entry);

      try {
        const stat = await fs.stat(entryPath);

        if (stat.isFile()) {
          continue;
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          continue;
        }

        throw error;
      }

      const state = await read(entry);

      if (state !== null) {
        states.push(state);
      }
    }

    return states;
  }

  async function remove(id: string): Promise<void> {
    const processDir = resolveProcessDir(stateDir, id);
    const removedDir = path.join(stateDir, `${REMOVED_STATE_PREFIX}${id}-${randomUUID()}`);
    await assertPathHasNoSymbolicLinks(fs, processDir);
    await assertRemovalTreeHasNoSymbolicLinks(fs, processDir);

    try {
      await fs.rename(processDir, removedDir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }

      throw error;
    }

    await removeDirectory(fs, removedDir).catch(() => undefined);
  }

  return { read, write, list, remove };
}

export function assertValidProcessStateDocument(value: unknown, id: string): ProcessState {
  if (!isProcessState(value, id)) {
    throw new Error(`Invalid process state document: ${id}`);
  }
  return value;
}

function isProcessState(value: unknown, id: string): value is ProcessState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const state = value as Partial<ProcessState>;
  return (
    state.id === id &&
    (state.pid === null || typeof state.pid === "number") &&
    (state.status === "running" ||
      state.status === "stopped" ||
      state.status === "crashed" ||
      state.status === "restarting") &&
    (state.runtime === "host" || state.runtime === "docker") &&
    isPositiveSafeIntegerOrNull(state.pid) &&
    isNonNegativeSafeInteger(state.restartCount) &&
    (state.lastExitCode === null || isNonNegativeSafeInteger(state.lastExitCode)) &&
    (state.lastStartedAt === null || typeof state.lastStartedAt === "string") &&
    (state.lastStoppedAt === null || typeof state.lastStoppedAt === "string") &&
    typeof state.command === "string" &&
    Array.isArray(state.args) &&
    state.args.every((argument) => typeof argument === "string")
  );
}

function isPositiveSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
