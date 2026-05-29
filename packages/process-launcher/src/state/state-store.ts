import path from "node:path";
import * as nodeFs from "node:fs/promises";
import type { LauncherFileSystem, ProcessState, StateStore } from "../types.js";

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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

  await fs.rm(directoryPath, { force: true });
}

export function createStateStore(
  stateDir: string,
  fs: LauncherFileSystem = nodeFs as unknown as LauncherFileSystem
): StateStore {
  async function read(id: string): Promise<ProcessState | null> {
    const statePath = path.join(stateDir, id, "state.json");

    try {
      const content = await fs.readFile(statePath, "utf8");
      return JSON.parse(content) as ProcessState;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async function write(id: string, state: ProcessState): Promise<void> {
    const processDir = path.join(stateDir, id);
    await fs.mkdir(processDir, { recursive: true });
    await fs.writeFile(path.join(processDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
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
    await removeDirectory(fs, path.join(stateDir, id));
  }

  return { read, write, list, remove };
}
