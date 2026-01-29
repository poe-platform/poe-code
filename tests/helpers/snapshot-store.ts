import { join } from "node:path";
import type { FileSystem } from "../../src/utils/file-system.js";
import type { LlmClient } from "../../src/services/llm-client.js";
import type { SnapshotEntry, SnapshotRequest } from "./snapshot-client.js";

export interface SnapshotSummary {
  key: string;
  model: string;
  prompt: string;
  recordedAt?: string;
  type?: string;
}

export async function listSnapshots(
  fs: FileSystem,
  snapshotDir: string,
  options?: { model?: string }
): Promise<SnapshotSummary[]> {
  const entries = await readSnapshotEntries(fs, snapshotDir);
  const filtered = filterByModel(entries, options?.model);
  return filtered.map((entry) => ({
    key: entry.key,
    model: entry.request.model,
    prompt: extractPrompt(entry.request),
    recordedAt: entry.metadata?.recordedAt,
    type: entry.request.type
  }));
}

export async function deleteSnapshots(
  fs: FileSystem,
  snapshotDir: string,
  options?: { key?: string; model?: string }
): Promise<number> {
  if (options?.key) {
    const deleted = await deleteSnapshotByKey(fs, snapshotDir, options.key);
    return deleted ? 1 : 0;
  }

  const entries = await readSnapshotEntries(fs, snapshotDir);
  const filtered = filterByModel(entries, options?.model);
  let deleted = 0;
  for (const entry of filtered) {
    const path = join(snapshotDir, `${entry.key}.json`);
    try {
      await fs.unlink(path);
      deleted += 1;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
  return deleted;
}

export async function refreshSnapshots(
  fs: FileSystem,
  snapshotDir: string,
  options: { client: LlmClient; key?: string; model?: string; now?: () => Date }
): Promise<number> {
  const entries = await readSnapshotEntries(fs, snapshotDir);
  const filtered = options.key
    ? entries.filter((entry) => entry.key === options.key)
    : filterByModel(entries, options.model);

  let refreshed = 0;
  for (const entry of filtered) {
    const prompt = extractPrompt(entry.request);
    if (!prompt) {
      continue;
    }
    const type = entry.request.type ?? "text";
    const response =
      type === "text"
        ? await options.client.text({
            model: entry.request.model,
            prompt,
            params: entry.request.params
          })
        : await options.client.media(type, {
            model: entry.request.model,
            prompt,
            params: entry.request.params
          });

    const updated: SnapshotEntry = {
      ...entry,
      response,
      metadata: {
        ...entry.metadata,
        recordedAt: (options.now ?? (() => new Date()))().toISOString(),
        model: entry.request.model,
        type
      }
    };

    const path = join(snapshotDir, `${entry.key}.json`);
    await fs.writeFile(path, JSON.stringify(updated, null, 2));
    refreshed += 1;
  }

  return refreshed;
}

async function readSnapshotEntries(
  fs: FileSystem,
  snapshotDir: string
): Promise<SnapshotEntry[]> {
  const files = await readSnapshotFiles(fs, snapshotDir);
  const entries: SnapshotEntry[] = [];
  for (const file of files) {
    const path = join(snapshotDir, file);
    try {
      const raw = await fs.readFile(path, "utf8");
      const parsed = JSON.parse(raw) as SnapshotEntry;
      if (parsed && typeof parsed.key === "string" && parsed.request) {
        entries.push(parsed);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
  return entries;
}

async function readSnapshotFiles(
  fs: FileSystem,
  snapshotDir: string
): Promise<string[]> {
  try {
    const files = await fs.readdir(snapshotDir);
    return files.filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function extractPrompt(request: SnapshotRequest): string {
  for (const message of request.messages) {
    if (message.role === "user") {
      return message.content;
    }
  }
  return "";
}

function filterByModel(
  entries: SnapshotEntry[],
  model?: string
): SnapshotEntry[] {
  if (!model) {
    return entries;
  }
  return entries.filter((entry) => entry.request.model === model);
}

async function deleteSnapshotByKey(
  fs: FileSystem,
  snapshotDir: string,
  key: string
): Promise<boolean> {
  const path = join(snapshotDir, `${key}.json`);
  try {
    await fs.unlink(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export async function findStaleSnapshots(
  fs: FileSystem,
  snapshotDir: string,
  accessedKeys: Set<string>
): Promise<string[]> {
  const entries = await readSnapshotEntries(fs, snapshotDir);
  const stale: string[] = [];
  for (const entry of entries) {
    if (!accessedKeys.has(entry.key)) {
      stale.push(entry.key);
    }
  }
  return stale;
}

export async function pruneSnapshots(
  fs: FileSystem,
  snapshotDir: string,
  accessedKeys: Set<string>
): Promise<string[]> {
  const stale = await findStaleSnapshots(fs, snapshotDir, accessedKeys);
  for (const key of stale) {
    const path = join(snapshotDir, `${key}.json`);
    try {
      await fs.unlink(path);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
  return stale;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
