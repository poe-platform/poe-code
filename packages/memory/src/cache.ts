import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { writeFileAtomically } from "./atomic-write.js";
import { hasOwnErrorCode } from "./errors.js";
import {
  assertNoSymlinkSegments,
  assertSafeRelPath,
  MEMORY_CACHE_DIR_RELPATH,
  MEMORY_INGEST_CACHE_DIR_RELPATH
} from "./paths.js";
import type { IngestCacheEntry, IngestCacheKey, MemoryRoot } from "./types.js";

export function computeIngestKey(input: {
  sourceBytes: Uint8Array;
  indexMdBytes: Uint8Array;
  promptTemplateVersion: string;
  agentId: string;
}): IngestCacheKey {
  const hash = sha256.create();
  hash.update(input.sourceBytes);
  hash.update(new TextEncoder().encode("\0"));
  hash.update(input.indexMdBytes);
  hash.update(new TextEncoder().encode("\0"));
  hash.update(new TextEncoder().encode(input.promptTemplateVersion));
  hash.update(new TextEncoder().encode("\0"));
  hash.update(new TextEncoder().encode(input.agentId));
  return bytesToHex(hash.digest());
}

export async function readCacheEntry(
  root: MemoryRoot,
  key: IngestCacheKey, runtime: MemoryRuntime = {}
): Promise<IngestCacheEntry | null> {
  const fs = memoryFileSystem(runtime);
  const safeKey = assertSafeRelPath(key);
  await assertIngestCachePathIsNotSymlink(root, runtime);
  const cachePath = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH, `${safeKey}.json`);

  let raw: string;
  try {
    raw = await fs.readFile(cachePath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }

    throw error;
  }

  try {
    return parseCacheEntry(JSON.parse(raw), key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Ignoring ingest cache entry "${key}": ${message}`);
    return null;
  }
}

export async function writeCacheEntry(root: MemoryRoot, entry: IngestCacheEntry, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  const key = assertSafeRelPath(entry.key);
  await assertIngestCachePathIsNotSymlink(root, runtime);
  await fs.mkdir(path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH), { recursive: true });
  await assertIngestCachePathIsNotSymlink(root, runtime);
  await writeFileAtomically(
    path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH, `${key}.json`),
    `${JSON.stringify(entry)}\n`, runtime
  );
}

export async function cacheStatus(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<{ entries: number; bytes: number }> {
  const fs = memoryFileSystem(runtime);
  await assertIngestCachePathIsNotSymlink(root, runtime);
  const ingestDir = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH);
  const fileNames = await readCacheFileNames(ingestDir, runtime);
  const sizes = await Promise.all(
    fileNames.map(async (fileName) => (await fs.stat(path.join(ingestDir, fileName))).size)
  );

  return {
    entries: fileNames.length,
    bytes: sizes.reduce((total, size) => total + size, 0)
  };
}

export async function clearCache(
  root: MemoryRoot,
  opts: { olderThanMs?: number } = {}, runtime: MemoryRuntime = {}
): Promise<{ removed: number }> {
  const fs = memoryFileSystem(runtime);
  await assertIngestCachePathIsNotSymlink(root, runtime);
  const ingestDir = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH);
  const cacheDir = path.join(root, MEMORY_CACHE_DIR_RELPATH);
  const fileNames = await readCacheFileNames(ingestDir, runtime);

  if (fileNames.length === 0) {
    if (opts.olderThanMs === undefined) {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }

    return { removed: 0 };
  }

  if (opts.olderThanMs === undefined) {
    await fs.rm(cacheDir, { recursive: true, force: true });
    return { removed: fileNames.length };
  }

  const cutoff = Date.now() - opts.olderThanMs;
  const expiredEntries: Array<{ filePath: string; content: string }> = [];

  for (const fileName of fileNames) {
    const key = fileName.slice(0, -".json".length);
    const entry = await readCacheEntry(root, key, runtime);

    if (entry === null || Date.parse(entry.ingestedAt) > cutoff) {
      continue;
    }

    const filePath = path.join(ingestDir, fileName);
    expiredEntries.push({ filePath, content: await fs.readFile(filePath, "utf8") });
  }

  try {
    for (const entry of expiredEntries) {
      await fs.rm(entry.filePath, { force: true });
    }
  } catch (error) {
    await Promise.all(
      expiredEntries.map((entry) => writeFileAtomically(entry.filePath, entry.content, runtime).catch(() => undefined))
    );
    throw error;
  }

  await removeEmptyDirectory(ingestDir, runtime);
  await removeEmptyDirectory(cacheDir, runtime);

  return { removed: expiredEntries.length };
}

async function assertIngestCachePathIsNotSymlink(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<void> {
  await assertNoSymlinkSegments(root, MEMORY_INGEST_CACHE_DIR_RELPATH, runtime);
}

function parseCacheEntry(value: unknown, requestedKey: string): IngestCacheEntry {
  const object = expectRecord(value);
  const key = expectString(getOwnEntry(object, "key"), "key");
  if (key !== requestedKey) {
    throw new Error(`Cache entry key "${key}" does not match requested key "${requestedKey}".`);
  }

  return {
    key,
    ingestedAt: expectString(getOwnEntry(object, "ingestedAt"), "ingestedAt"),
    sourceLabel: expectString(getOwnEntry(object, "sourceLabel"), "sourceLabel"),
    diff: parseMemoryDiff(getOwnEntry(object, "diff")),
    exitCode: expectNonNegativeInteger(getOwnEntry(object, "exitCode"), "exitCode"),
    durationMs: expectNonNegativeInteger(getOwnEntry(object, "durationMs"), "durationMs"),
    memoryTokens: expectNonNegativeInteger(getOwnEntry(object, "memoryTokens"), "memoryTokens"),
    sourceTokens: expectNonNegativeInteger(getOwnEntry(object, "sourceTokens"), "sourceTokens"),
    promptTemplateVersion: expectString(
      getOwnEntry(object, "promptTemplateVersion"),
      "promptTemplateVersion"
    ),
    agentId: expectString(getOwnEntry(object, "agentId"), "agentId")
  };
}

function parseMemoryDiff(value: unknown): IngestCacheEntry["diff"] {
  const object = expectRecord(value);

  return {
    created: expectStringArray(getOwnEntry(object, "created"), "diff.created"),
    updated: expectStringArray(getOwnEntry(object, "updated"), "diff.updated"),
    deleted: expectStringArray(getOwnEntry(object, "deleted"), "diff.deleted")
  };
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string at "${field}".`);
  }

  return value;
}

function expectNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected non-negative integer at "${field}".`);
  }

  return value;
}

function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected string[] at "${field}".`);
  }

  return value;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

async function readCacheFileNames(ingestDir: string, runtime: MemoryRuntime = {}): Promise<string[]> {
  const fs = memoryFileSystem(runtime);
  try {
    return (await fs.readdir(ingestDir))
      .filter((fileName) => path.extname(fileName).toLowerCase() === ".json")
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function removeEmptyDirectory(directoryPath: string, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  try {
    const remainingEntries = await fs.readdir(directoryPath);
    if (remainingEntries.length === 0) {
      await fs.rmdir(directoryPath);
    }
  } catch (error) {
    if (isMissing(error)) {
      return;
    }

    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
