import * as fs from "node:fs/promises";
import path from "node:path";
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
  if (path.posix.isAbsolute(slashNormalized) || path.win32.isAbsolute(slashNormalized)) {
    throw new MemoryPathError(`Expected a relative path, received absolute path "${input}".`);
  }

  const normalized = path.posix.normalize(slashNormalized);
  if (normalized === "." || normalized.length === 0) {
    throw new MemoryPathError("Expected a relative path to a file or directory.");
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new MemoryPathError(`Relative path "${input}" cannot escape the memory root.`);
  }

  return normalized;
}

export async function assertNoSymlinkSegments(root: MemoryRoot, relPath: string): Promise<void> {
  const normalizedRelPath = assertSafeRelPath(relPath);
  await assertMemoryRootIsNotSymlink(root);
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

export async function assertMemoryRootIsNotSymlink(root: MemoryRoot): Promise<void> {
  const absoluteRoot = path.resolve(root);
  const pathRoot = path.parse(absoluteRoot).root;
  let currentPath = pathRoot;

  for (const segment of absoluteRoot.slice(pathRoot.length).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);

    try {
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
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

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
