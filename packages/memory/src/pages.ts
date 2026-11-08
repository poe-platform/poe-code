import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
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

export async function listPages(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<MemoryPage[]> {
  return await readMarkdownFilesUnder(root, MEMORY_PAGES_DIR_RELPATH, runtime);
}

export async function listMemoryFiles(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<MemoryPage[]> {
  return await readMarkdownFilesUnder(root, "", runtime);
}

async function readMarkdownFilesUnder(
  root: MemoryRoot,
  startRelPath: string, runtime: MemoryRuntime = {}
): Promise<MemoryPage[]> {
  const relPaths = await collectMarkdownRelPaths(root, startRelPath, runtime);
  const pages = await Promise.all(relPaths.map(async (relPath) => readPage(root, relPath, runtime)));
  return pages.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

export async function readPage(root: MemoryRoot, relPath: string, runtime: MemoryRuntime = {}): Promise<MemoryPage> {
  const fs = memoryFileSystem(runtime);
  const normalizedRelPath = assertMarkdownRelPath(relPath);
  await assertNoSymlinkSegments(root, normalizedRelPath, runtime);
  const absPath = path.join(root, normalizedRelPath);
  const [content, stat] = await Promise.all([fs.readFile(absPath, "utf8"), fs.stat(absPath)]);

  try {
    const parsed = parseFrontmatter(content);
    return {
      relPath: normalizedRelPath,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      bytes: new TextEncoder().encode(content).byteLength,
      mtimeMs: stat.mtimeMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to parse frontmatter for "${normalizedRelPath}": ${message}`);
    return {
      relPath: normalizedRelPath,
      frontmatter: {},
      body: content,
      bytes: new TextEncoder().encode(content).byteLength,
      mtimeMs: stat.mtimeMs
    };
  }
}

export async function collectMarkdownRelPaths(
  root: MemoryRoot,
  startRelPath = "", runtime: MemoryRuntime = {}
): Promise<string[]> {
  const normalizedStartRelPath = startRelPath.length === 0 ? "" : assertSafeRelPath(startRelPath);
  await assertMemoryRootIsNotSymlink(root, runtime);
  if (normalizedStartRelPath.length > 0) {
    await assertNoSymlinkSegments(root, normalizedStartRelPath, runtime);
  } else {
    await assertNoSymlinkSegments(root, MEMORY_PAGES_DIR_RELPATH, runtime);
  }

  const relPaths: string[] = [];
  await collectMarkdownRelPathsInto(root, normalizedStartRelPath, relPaths, runtime);
  return relPaths.sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownRelPathsInto(
  root: MemoryRoot,
  currentRelPath: string,
  relPaths: string[], runtime: MemoryRuntime = {}
): Promise<void> {
  const fs = memoryFileSystem(runtime);
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
      currentRelPath.length === 0 ? entryName : path.join(currentRelPath, entryName);
    const entryAbsPath = path.join(root, entryRelPath);
    const entryStat = await fs.lstat(entryAbsPath);

    if (entryStat.isSymbolicLink()) {
      continue;
    }

    if (entryStat.isDirectory()) {
      if (entryName === MEMORY_CACHE_DIR_RELPATH) {
        continue;
      }

      await collectMarkdownRelPathsInto(root, entryRelPath, relPaths, runtime);
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
  return path.extname(relPath).toLowerCase() === ".md";
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
