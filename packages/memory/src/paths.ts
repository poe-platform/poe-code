import path from "node:path";
import type { MemoryRoot } from "./types.js";

export const MEMORY_INDEX_RELPATH = "INDEX.md";
export const MEMORY_LOG_RELPATH = "LOG.md";
export const MEMORY_LOCK_RELPATH = ".lock";
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
