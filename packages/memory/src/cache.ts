import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomically } from "./atomic-write.js";
import { assertSafeRelPath, MEMORY_CACHE_DIR_RELPATH, MEMORY_INGEST_CACHE_DIR_RELPATH } from "./paths.js";
import type { IngestCacheEntry, IngestCacheKey, MemoryRoot } from "./types.js";

export function computeIngestKey(input: {
  sourceBytes: Buffer;
  indexMdBytes: Buffer;
  promptTemplateVersion: string;
  agentId: string;
}): IngestCacheKey {
  const hash = createHash("sha256");
  hash.update(input.sourceBytes);
  hash.update("\0");
  hash.update(input.indexMdBytes);
  hash.update("\0");
  hash.update(input.promptTemplateVersion);
  hash.update("\0");
  hash.update(input.agentId);
  return hash.digest("hex");
}

export async function readCacheEntry(
  root: MemoryRoot,
  key: IngestCacheKey
): Promise<IngestCacheEntry | null> {
  const cachePath = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH, `${assertSafeRelPath(key)}.json`);

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

export async function writeCacheEntry(root: MemoryRoot, entry: IngestCacheEntry): Promise<void> {
  const key = assertSafeRelPath(entry.key);
  await fs.mkdir(path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH), { recursive: true });
  await writeFileAtomically(
    path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH, `${key}.json`),
    `${JSON.stringify(entry)}\n`
  );
}

export async function cacheStatus(root: MemoryRoot): Promise<{ entries: number; bytes: number }> {
  const ingestDir = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH);
  const fileNames = await readCacheFileNames(ingestDir);
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
  opts: { olderThanMs?: number } = {}
): Promise<{ removed: number }> {
  const ingestDir = path.join(root, MEMORY_INGEST_CACHE_DIR_RELPATH);
  const cacheDir = path.join(root, MEMORY_CACHE_DIR_RELPATH);
  const fileNames = await readCacheFileNames(ingestDir);

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
    const entry = await readCacheEntry(root, key);

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
      expiredEntries.map((entry) => writeFileAtomically(entry.filePath, entry.content).catch(() => undefined))
    );
    throw error;
  }

  await removeEmptyDirectory(ingestDir);
  await removeEmptyDirectory(cacheDir);

  return { removed: expiredEntries.length };
}

function parseCacheEntry(value: unknown, _key: string): IngestCacheEntry {
  const object = expectRecord(value);

  return {
    key: expectString(object.key, "key"),
    ingestedAt: expectString(object.ingestedAt, "ingestedAt"),
    sourceLabel: expectString(object.sourceLabel, "sourceLabel"),
    diff: parseMemoryDiff(object.diff),
    exitCode: expectNumber(object.exitCode, "exitCode"),
    durationMs: expectNumber(object.durationMs, "durationMs"),
    memoryTokens: expectNumber(object.memoryTokens, "memoryTokens"),
    sourceTokens: expectNumber(object.sourceTokens, "sourceTokens"),
    promptTemplateVersion: expectString(object.promptTemplateVersion, "promptTemplateVersion"),
    agentId: expectString(object.agentId, "agentId")
  };
}

function parseMemoryDiff(value: unknown): IngestCacheEntry["diff"] {
  const object = expectRecord(value);

  return {
    created: expectStringArray(object.created, "diff.created"),
    updated: expectStringArray(object.updated, "diff.updated"),
    deleted: expectStringArray(object.deleted, "diff.deleted")
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

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected number at "${field}".`);
  }

  return value;
}

function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected string[] at "${field}".`);
  }

  return value;
}

async function readCacheFileNames(ingestDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(ingestDir))
      .filter((fileName) => path.posix.extname(fileName).toLowerCase() === ".json")
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function removeEmptyDirectory(directoryPath: string): Promise<void> {
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
