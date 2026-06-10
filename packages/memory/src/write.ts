import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
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
  opts: { frontmatter?: PageFrontmatter; reason: string }
): Promise<MemoryDiff> {
  const pageRelPath = assertPageRelPath(relPath);
  await assertNoSymlinkSegments(root, pageRelPath);
  const pagePath = path.join(root, pageRelPath);
  const originalPage = await readMarkdownIfPresent(pagePath);

  const before = await snapshot(root);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  await assertNoSymlinkSegments(root, pageRelPath);

  try {
    await writeFileAtomically(pagePath, serializeFrontmatter(opts.frontmatter ?? {}, body));
    return await reconcile(root, before, "update", opts.reason);
  } catch (error) {
    await restorePage(pagePath, originalPage);
    throw error;
  }
}

export async function appendToPage(
  root: MemoryRoot,
  relPath: string,
  content: string,
  opts: { reason: string }
): Promise<MemoryDiff> {
  const pageRelPath = assertPageRelPath(relPath);
  await assertNoSymlinkSegments(root, pageRelPath);

  const pagePath = path.join(root, pageRelPath);
  const originalPage = await readMarkdownIfPresent(pagePath);
  const before = await snapshot(root);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  await assertNoSymlinkSegments(root, pageRelPath);

  const parsed =
    originalPage === undefined ? { frontmatter: {}, body: "" } : parseFrontmatter(originalPage);

  try {
    await writeFileAtomically(
      pagePath,
      serializeFrontmatter(parsed.frontmatter, `${parsed.body}${content}`)
    );
    return await reconcile(root, before, "update", opts.reason);
  } catch (error) {
    await restorePage(pagePath, originalPage);
    throw error;
  }
}

export async function clearMemory(root: MemoryRoot): Promise<void> {
  await assertMemoryRootIsNotSymlink(root);
  const stagedRoot = `${root}.clear-${randomUUID()}`;
  const backupRoot = `${root}.backup-${randomUUID()}`;
  let originalMoved = false;

  try {
    await initMemory(stagedRoot);
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
    path.posix.extname(normalizedRelPath).toLowerCase() !== ".md"
  ) {
    throw new Error(`Expected a markdown page path under "${MEMORY_PAGES_DIR_RELPATH}/".`);
  }

  return normalizedRelPath;
}

async function readMarkdownIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function restorePage(filePath: string, originalPage: string | undefined): Promise<void> {
  if (originalPage === undefined) {
    await fs.unlink(filePath).catch(() => undefined);
    return;
  }

  await writeFileAtomically(filePath, originalPage).catch(() => undefined);
}
