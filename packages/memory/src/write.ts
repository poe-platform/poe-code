import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { writeFileAtomically } from "./atomic-write.js";
import { hasOwnErrorCode } from "./errors.js";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";
import { initMemory } from "./init.js";
import {
  assertMemoryRootIsNotSymlink,
  assertNoSymlinkSegments,
  assertSafeRelPath,
  MEMORY_PAGES_DIR_RELPATH
} from "./paths.js";
import { reconcile, snapshot } from "./reconcile.js";
import type { MemoryDiff, MemoryRoot, PageFrontmatter } from "./types.js";

export async function writePage(
  root: MemoryRoot,
  relPath: string,
  body: string,
  opts: { frontmatter?: PageFrontmatter; reason: string }, runtime: MemoryRuntime = {}
): Promise<MemoryDiff> {
  const fs = memoryFileSystem(runtime);
  const pageRelPath = assertPageRelPath(relPath);
  await assertNoSymlinkSegments(root, pageRelPath, runtime);
  const pagePath = path.join(root, pageRelPath);
  const originalPage = await readMarkdownIfPresent(pagePath, runtime);

  const before = await snapshot(root, runtime);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  await assertNoSymlinkSegments(root, pageRelPath, runtime);

  try {
    await writeFileAtomically(pagePath, serializeFrontmatter(opts.frontmatter ?? {}, body), runtime);
    return await reconcile(root, before, "update", opts.reason, runtime);
  } catch (error) {
    await restorePage(pagePath, originalPage, runtime);
    throw error;
  }
}

export async function appendToPage(
  root: MemoryRoot,
  relPath: string,
  content: string,
  opts: { reason: string }, runtime: MemoryRuntime = {}
): Promise<MemoryDiff> {
  const fs = memoryFileSystem(runtime);
  const pageRelPath = assertPageRelPath(relPath);
  await assertNoSymlinkSegments(root, pageRelPath, runtime);

  const pagePath = path.join(root, pageRelPath);
  const originalPage = await readMarkdownIfPresent(pagePath, runtime);
  const before = await snapshot(root, runtime);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  await assertNoSymlinkSegments(root, pageRelPath, runtime);

  const parsed = parseAppendTarget(originalPage, pageRelPath);

  try {
    await writeFileAtomically(
      pagePath,
      serializeFrontmatter(parsed.frontmatter, `${parsed.body}${content}`), runtime
    );
    return await reconcile(root, before, "update", opts.reason, runtime);
  } catch (error) {
    await restorePage(pagePath, originalPage, runtime);
    throw error;
  }
}

function parseAppendTarget(
  originalPage: string | undefined,
  relPath: string
): { frontmatter: PageFrontmatter; body: string } {
  if (originalPage === undefined) {
    return { frontmatter: {}, body: "" };
  }

  try {
    return parseFrontmatter(originalPage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to parse frontmatter for "${relPath}": ${message}`);
    return { frontmatter: {}, body: originalPage };
  }
}

export async function clearMemory(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  await assertMemoryRootIsNotSymlink(root, runtime);
  const stagedRoot = `${root}.clear-${crypto.randomUUID()}`;
  const backupRoot = `${root}.backup-${crypto.randomUUID()}`;
  let originalMoved = false;

  try {
    await initMemory(stagedRoot, runtime);
    await fs.rename(root, backupRoot);
    originalMoved = true;
    await fs.rename(stagedRoot, root);
  } catch (error) {
    if (originalMoved) {
      await fs.rename(backupRoot, root).catch(() => undefined);
    }
    await fs.rm(stagedRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
}

function assertPageRelPath(relPath: string): string {
  const normalizedRelPath = assertSafeRelPath(relPath);
  if (
    !normalizedRelPath.startsWith(`${MEMORY_PAGES_DIR_RELPATH}/`) ||
    path.extname(normalizedRelPath).toLowerCase() !== ".md"
  ) {
    throw new Error(`Expected a markdown page path under "${MEMORY_PAGES_DIR_RELPATH}/".`);
  }

  return normalizedRelPath;
}

async function readMarkdownIfPresent(filePath: string, runtime: MemoryRuntime = {}): Promise<string | undefined> {
  const fs = memoryFileSystem(runtime);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function restorePage(filePath: string, originalPage: string | undefined, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  if (originalPage === undefined) {
    await fs.unlink(filePath).catch(() => undefined);
    return;
  }

  await writeFileAtomically(filePath, originalPage, runtime).catch(() => undefined);
}
