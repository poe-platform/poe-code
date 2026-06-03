import * as fs from "node:fs/promises";
import path from "node:path";
import { MEMORY_INDEX_RELPATH, MEMORY_LOG_RELPATH, MEMORY_PAGES_DIR_RELPATH } from "./paths.js";
import { collectMarkdownRelPaths } from "./pages.js";
import type { MemoryRoot } from "./types.js";

export async function statusOf(root: MemoryRoot): Promise<{
  pageCount: number;
  totalBytes: number;
  lastWriteAt: string | null;
  initialized: boolean;
}> {
  if (
    !(await pathExists(root)) ||
    !(await pathExists(path.join(root, MEMORY_INDEX_RELPATH))) ||
    !(await pathExists(path.join(root, MEMORY_LOG_RELPATH))) ||
    !(await pathExists(path.join(root, MEMORY_PAGES_DIR_RELPATH)))
  ) {
    return {
      pageCount: 0,
      totalBytes: 0,
      lastWriteAt: null,
      initialized: false
    };
  }

  const [pageRelPaths, markdownRelPaths] = await Promise.all([
    collectMarkdownRelPaths(root, MEMORY_PAGES_DIR_RELPATH),
    collectMarkdownRelPaths(root)
  ]);

  let totalBytes = 0;
  let lastWriteAtMs = Number.NEGATIVE_INFINITY;

  for (const relPath of markdownRelPaths) {
    const stat = await fs.stat(path.join(root, relPath));
    totalBytes += stat.size;
    lastWriteAtMs = Math.max(lastWriteAtMs, stat.mtimeMs);
  }

  return {
    pageCount: pageRelPaths.length,
    totalBytes,
    lastWriteAt: Number.isFinite(lastWriteAtMs) ? new Date(lastWriteAtMs).toISOString() : null,
    initialized: true
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}
