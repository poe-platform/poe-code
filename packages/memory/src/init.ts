import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { hasOwnErrorCode } from "./errors.js";
import {
  assertMemoryRootIsNotSymlink,
  MEMORY_INDEX_RELPATH,
  MEMORY_LOG_RELPATH,
  MEMORY_PAGES_DIR_RELPATH
} from "./paths.js";
import type { MemoryRoot } from "./types.js";

export async function initMemory(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  await assertMemoryRootIsNotSymlink(root, runtime);
  const rootExisted = await pathExists(root, runtime);
  const pagesPath = path.join(root, MEMORY_PAGES_DIR_RELPATH);
  const pagesExisted = await pathExists(pagesPath, runtime);
  const indexPath = path.join(root, MEMORY_INDEX_RELPATH);
  const logPath = path.join(root, MEMORY_LOG_RELPATH);
  let indexCreated = false;
  let logCreated = false;

  try {
    await fs.mkdir(pagesPath, { recursive: true });
    await assertMemoryRootIsNotSymlink(root, runtime);
    indexCreated = await writeFileIfMissing(indexPath, "# Memory index\n", runtime);
    logCreated = await writeFileIfMissing(logPath, "", runtime);
  } catch (error) {
    if (logCreated) {
      await fs.unlink(logPath).catch(() => undefined);
    }
    if (indexCreated) {
      await fs.unlink(indexPath).catch(() => undefined);
    }
    if (!pagesExisted) {
      await fs.rmdir(pagesPath).catch(() => undefined);
    }
    if (!rootExisted) {
      await fs.rmdir(root).catch(() => undefined);
    }

    throw error;
  }
}

async function writeFileIfMissing(filePath: string, content: string, runtime: MemoryRuntime = {}): Promise<boolean> {
  const fs = memoryFileSystem(runtime);
  try {
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (!hasOwnErrorCode(error, "EEXIST")) {
      await fs.unlink(filePath).catch(() => undefined);
      throw error;
    }

    return false;
  }
}

async function pathExists(targetPath: string, runtime: MemoryRuntime = {}): Promise<boolean> {
  const fs = memoryFileSystem(runtime);
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}
