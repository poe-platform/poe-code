import * as fs from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  assertMemoryRootIsNotSymlink,
  assertNoSymlinkSegments,
  assertSafeRelPath,
  MEMORY_CACHE_DIR_RELPATH,
  MEMORY_PAGES_DIR_RELPATH
} from "./paths.js";
import type { MemoryPage, MemoryRoot } from "./types.js";

export async function listPages(root: MemoryRoot): Promise<MemoryPage[]> {
  return await readMarkdownFilesUnder(root, MEMORY_PAGES_DIR_RELPATH);
}

export async function listMemoryFiles(root: MemoryRoot): Promise<MemoryPage[]> {
  return await readMarkdownFilesUnder(root, "");
}

async function readMarkdownFilesUnder(
  root: MemoryRoot,
  startRelPath: string
): Promise<MemoryPage[]> {
  const relPaths = await collectMarkdownRelPaths(root, startRelPath);
  const pages = await Promise.all(relPaths.map(async (relPath) => readPage(root, relPath)));
  return pages.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

export async function readPage(root: MemoryRoot, relPath: string): Promise<MemoryPage> {
  const normalizedRelPath = assertMarkdownRelPath(relPath);
  await assertNoSymlinkSegments(root, normalizedRelPath);
  const absPath = path.join(root, normalizedRelPath);
  const [content, stat] = await Promise.all([fs.readFile(absPath, "utf8"), fs.stat(absPath)]);

  try {
    const parsed = parseFrontmatter(content);
    return {
      relPath: normalizedRelPath,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      bytes: Buffer.byteLength(content),
      mtimeMs: stat.mtimeMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to parse frontmatter for "${normalizedRelPath}": ${message}`);
    return {
      relPath: normalizedRelPath,
      frontmatter: {},
      body: content,
      bytes: Buffer.byteLength(content),
      mtimeMs: stat.mtimeMs
    };
  }
}

export async function collectMarkdownRelPaths(
  root: MemoryRoot,
  startRelPath = ""
): Promise<string[]> {
  const normalizedStartRelPath = startRelPath.length === 0 ? "" : assertSafeRelPath(startRelPath);
  await assertMemoryRootIsNotSymlink(root);
  if (normalizedStartRelPath.length > 0) {
    await assertNoSymlinkSegments(root, normalizedStartRelPath);
  } else {
    await assertNoSymlinkSegments(root, MEMORY_PAGES_DIR_RELPATH);
  }

  const relPaths: string[] = [];
  await collectMarkdownRelPathsInto(root, normalizedStartRelPath, relPaths);
  return relPaths.sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownRelPathsInto(
  root: MemoryRoot,
  currentRelPath: string,
  relPaths: string[]
): Promise<void> {
  const absPath = path.join(root, currentRelPath);

  let entryNames: string[];
  try {
    entryNames = await fs.readdir(absPath);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }

    throw error;
  }

  for (const entryName of entryNames.sort((left, right) => left.localeCompare(right))) {
    const entryRelPath =
      currentRelPath.length === 0 ? entryName : path.posix.join(currentRelPath, entryName);
    const entryAbsPath = path.join(root, entryRelPath);
    const entryStat = await fs.lstat(entryAbsPath);

    if (entryStat.isSymbolicLink()) {
      continue;
    }

    if (entryStat.isDirectory()) {
      if (entryName === MEMORY_CACHE_DIR_RELPATH) {
        continue;
      }

      await collectMarkdownRelPathsInto(root, entryRelPath, relPaths);
      continue;
    }

    if (!entryStat.isFile()) {
      continue;
    }

    if (!isMarkdownPath(entryRelPath)) {
      console.warn(`Skipping non-markdown memory file "${entryRelPath}".`);
      continue;
    }

    relPaths.push(entryRelPath);
  }
}

function assertMarkdownRelPath(relPath: string): string {
  const normalizedRelPath = assertSafeRelPath(relPath);
  if (!isMarkdownPath(normalizedRelPath)) {
    throw new Error(`Expected a markdown path, received "${relPath}".`);
  }

  return normalizedRelPath;
}

function isMarkdownPath(relPath: string): boolean {
  return path.posix.extname(relPath).toLowerCase() === ".md";
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
