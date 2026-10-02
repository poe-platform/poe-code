import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { hasOwnErrorCode } from "./errors.js";
import type { MemoryRoot } from "./types.js";

export const MEMORY_INDEX_RELPATH = "INDEX.md";
export const MEMORY_LOG_RELPATH = "LOG.md";
export const MEMORY_PAGES_DIR_RELPATH = "pages";
export const MEMORY_CACHE_DIR_RELPATH = ".cache";
export const MEMORY_INGEST_CACHE_DIR_RELPATH = `${MEMORY_CACHE_DIR_RELPATH}/ingest`;

export class MemoryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryPathError";
  }
}

export function resolveMemoryRoot(cwd: string): MemoryRoot {
  return path.resolve(cwd, ".poe-code", "memory");
}

export function assertSafeRelPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new MemoryPathError("Expected a non-empty relative path.");
  }

  const slashNormalized = trimmed.replaceAll("\\", "/");
  if (path.isAbsolute(slashNormalized) || (slashNormalized.length >= 3 && slashNormalized[1] === ":" && slashNormalized[2] === "/")) {
    throw new MemoryPathError(`Expected a relative path, received absolute path "${input}".`);
  }

  const normalized = path.normalize(slashNormalized);
  if (normalized === "." || normalized.length === 0) {
    throw new MemoryPathError("Expected a relative path to a file or directory.");
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new MemoryPathError(`Relative path "${input}" cannot escape the memory root.`);
  }

  return normalized;
}

export async function assertNoSymlinkSegments(root: MemoryRoot, relPath: string, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  const normalizedRelPath = assertSafeRelPath(relPath);
  await assertMemoryRootIsNotSymlink(root, runtime);
  let currentPath = root;

  for (const segment of normalizedRelPath.split("/")) {
    currentPath = path.join(currentPath, segment);

    try {
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        throw new MemoryPathError(`Memory path "${relPath}" cannot traverse a symbolic link.`);
      }
    } catch (error) {
      if (isMissing(error)) {
        return;
      }

      throw error;
    }
  }
}

export async function assertMemoryRootIsNotSymlink(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  const absoluteRoot = path.resolve(root);
  const pathRoot = "/";
  let currentPath = pathRoot;

  for (const segment of absoluteRoot.slice(pathRoot.length).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);

    try {
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        if (await isAllowedMacSystemAlias(currentPath, runtime)) {
          continue;
        }
        throw new MemoryPathError(`Memory root "${root}" cannot be a symbolic link.`);
      }
    } catch (error) {
      if (isMissing(error)) {
        return;
      }

      throw error;
    }
  }
}

async function isAllowedMacSystemAlias(currentPath: string, runtime: MemoryRuntime = {}): Promise<boolean> {
  const fs = memoryFileSystem(runtime);
  if (currentPath !== "/var") {
    return false;
  }

  try {
    const target = await fs.readlink(currentPath);
    return target === "/private/var" || target === "private/var";
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
