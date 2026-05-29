import * as fs from "node:fs/promises";
import path from "node:path";
import {
  assertMemoryRootIsNotSymlink,
  MEMORY_INDEX_RELPATH,
  MEMORY_LOG_RELPATH,
  MEMORY_PAGES_DIR_RELPATH
} from "./paths.js";
import type { MemoryRoot } from "./types.js";

export async function initMemory(root: MemoryRoot): Promise<void> {
  await assertMemoryRootIsNotSymlink(root);
  await fs.mkdir(path.join(root, MEMORY_PAGES_DIR_RELPATH), { recursive: true });
  await writeFileIfMissing(path.join(root, MEMORY_INDEX_RELPATH), "# Memory index\n");
  await writeFileIfMissing(path.join(root, MEMORY_LOG_RELPATH), "");
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
