import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AgentTraceFileSystem,
  AgentTraceSource,
  TraceReader,
  TraceReference
} from "../types.js";
import { mapConcurrent } from "./concurrency.js";
import { readHead } from "./head.js";

const MANIFEST_VERSION = 1;
const HOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const IO_CONCURRENCY = 32;

export interface TraceIndexRecord {
  path: string;
  source: AgentTraceSource;
  id: string;
  cwd?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  updatedAtMs: number;
  mtimeMs: number;
  size: number;
}

interface ManifestShard {
  file: string;
  source: AgentTraceSource;
  maxUpdatedAtMs: number;
  count: number;
}

interface Manifest {
  version: number;
  shards: Record<string, ManifestShard>;
}

export interface TraceIndexSyncOptions {
  readers: TraceReader[];
  homeDir: string;
  now?: () => number;
  onProgress?: (progress: { scannedDirs: number; headReads: number }) => void;
}

export interface TraceIndexSyncStats {
  scannedDirs: number;
  statted: number;
  headReads: number;
  added: number;
  updated: number;
  removed: number;
}

export interface TraceIndexQueryOptions {
  cwd?: string;
  allWorkspaces?: boolean;
  since?: Date;
  sources?: AgentTraceSource[];
  limit: number;
}

export interface TraceIndex {
  sync(options: TraceIndexSyncOptions): Promise<TraceIndexSyncStats>;
  query(options: TraceIndexQueryOptions): Promise<TraceReference[]>;
  rebuild(options: TraceIndexSyncOptions): Promise<TraceIndexSyncStats>;
}

interface RenameCapableFileSystem {
  rename(from: string, to: string): Promise<void>;
}

interface UnlinkCapableFileSystem {
  unlink(path: string): Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function shardFileName(directory: string): string {
  return `${createHash("sha256").update(directory).digest("hex").slice(0, 16)}.jsonl`;
}

function parseShardLines(contents: string): TraceIndexRecord[] {
  const records: TraceIndexRecord[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const value = JSON.parse(line) as unknown;
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as TraceIndexRecord).path === "string" &&
        typeof (value as TraceIndexRecord).id === "string"
      ) {
        records.push(value as TraceIndexRecord);
      }
    } catch {
      // Corrupt shard lines are dropped; the next sync re-derives them.
    }
  }
  return records;
}

function referenceFromRecord(record: TraceIndexRecord): TraceReference {
  return {
    source: record.source,
    id: record.id,
    path: record.path,
    ...(record.cwd !== undefined ? { cwd: record.cwd } : {}),
    ...(record.updatedAtMs > 0 ? { updatedAt: new Date(record.updatedAtMs) } : {}),
    ...(record.title !== undefined ? { title: record.title } : {}),
    ...(record.metadata !== undefined ? { metadata: record.metadata } : {})
  };
}

export async function openTraceIndex(options: {
  dir: string;
  fs: AgentTraceFileSystem;
}): Promise<TraceIndex> {
  const { dir, fs } = options;
  const manifestPath = path.join(dir, "manifest.json");
  const shardsDir = path.join(dir, "shards");

  const writeAtomic = async (filePath: string, data: string): Promise<void> => {
    const rename = (fs as Partial<RenameCapableFileSystem>).rename;
    if (typeof rename === "function") {
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, data);
      await rename.call(fs, tempPath, filePath);
      return;
    }
    await fs.writeFile(filePath, data);
  };

  const loadManifest = async (): Promise<Manifest> => {
    try {
      const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
      if (parsed.version === MANIFEST_VERSION && typeof parsed.shards === "object") {
        return parsed;
      }
    } catch {
      // Missing or corrupt manifest: start empty and re-derive on sync.
    }
    return { version: MANIFEST_VERSION, shards: {} };
  };

  const loadShard = async (shard: ManifestShard): Promise<TraceIndexRecord[]> => {
    try {
      return parseShardLines(await fs.readFile(path.join(shardsDir, shard.file), "utf8"));
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  };

  const sync = async (syncOptions: TraceIndexSyncOptions): Promise<TraceIndexSyncStats> => {
    const now = syncOptions.now ?? Date.now;
    const stats: TraceIndexSyncStats = {
      scannedDirs: 0,
      statted: 0,
      headReads: 0,
      added: 0,
      updated: 0,
      removed: 0
    };
    await fs.mkdir(shardsDir, { recursive: true });
    const manifest = await loadManifest();
    let manifestDirty = false;
    const scannedSources = new Set<AgentTraceSource>();
    const seenDirectories = new Set<string>();
    const hotCutoffMs = now() - HOT_WINDOW_MS;

    for (const reader of syncOptions.readers) {
      const scan = reader.scan?.bind(reader);
      const readHeadMetadata = reader.readHeadMetadata?.bind(reader);
      if (scan === undefined || readHeadMetadata === undefined) {
        continue;
      }
      scannedSources.add(reader.id);

      for await (const { directory, files } of scan({ homeDir: syncOptions.homeDir, fs })) {
        stats.scannedDirs += 1;
        seenDirectories.add(directory);
        const shardEntry = manifest.shards[directory];
        const existing = shardEntry === undefined ? [] : await loadShard(shardEntry);
        const byPath = new Map(existing.map((record) => [record.path, record]));
        const fileSet = new Set(files);

        const toStat = files.filter((filePath) => {
          const record = byPath.get(filePath);
          return record === undefined || record.updatedAtMs >= hotCutoffMs;
        });
        stats.statted += toStat.length;
        const statResults = await mapConcurrent(toStat, IO_CONCURRENCY, async (filePath) => ({
          filePath,
          stat: await fs.stat(filePath).catch(() => undefined)
        }));

        const changed = statResults.filter(({ filePath, stat }) => {
          if (stat === undefined || !stat.isFile()) {
            return false;
          }
          const record = byPath.get(filePath);
          const mtimeMs = stat.mtime?.getTime() ?? 0;
          const size = stat.size ?? -1;
          return record === undefined || record.mtimeMs !== mtimeMs || record.size !== size;
        });

        const updatedRecords = await mapConcurrent(
          changed,
          IO_CONCURRENCY,
          async ({ filePath, stat }): Promise<TraceIndexRecord | undefined> => {
            stats.headReads += 1;
            const head = await readHead(fs, filePath).catch(() => undefined);
            if (head === undefined) {
              return undefined;
            }
            const metadata = readHeadMetadata(head, filePath);
            if (metadata === undefined) {
              return undefined;
            }
            const mtimeMs = stat?.mtime?.getTime() ?? 0;
            return {
              path: filePath,
              source: reader.id,
              id: metadata.id,
              ...(metadata.cwd !== undefined ? { cwd: metadata.cwd } : {}),
              ...(metadata.title !== undefined ? { title: metadata.title } : {}),
              ...(metadata.metadata !== undefined ? { metadata: metadata.metadata } : {}),
              updatedAtMs: mtimeMs > 0 ? mtimeMs : (metadata.updatedAt?.getTime() ?? 0),
              mtimeMs,
              size: stat?.size ?? -1
            };
          }
        );

        const removedCount = existing.filter((record) => !fileSet.has(record.path)).length;
        const freshRecords = updatedRecords.filter(
          (record): record is TraceIndexRecord => record !== undefined
        );
        if (freshRecords.length === 0 && removedCount === 0) {
          syncOptions.onProgress?.({ scannedDirs: stats.scannedDirs, headReads: stats.headReads });
          continue;
        }

        for (const record of freshRecords) {
          if (byPath.has(record.path)) {
            stats.updated += 1;
          } else {
            stats.added += 1;
          }
          byPath.set(record.path, record);
        }
        for (const record of existing) {
          if (!fileSet.has(record.path)) {
            byPath.delete(record.path);
            stats.removed += 1;
          }
        }

        const records = [...byPath.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        const file = shardEntry?.file ?? shardFileName(directory);
        if (records.length === 0) {
          delete manifest.shards[directory];
        } else {
          await writeAtomic(
            path.join(shardsDir, file),
            records.map((record) => JSON.stringify(record)).join("\n") + "\n"
          );
          manifest.shards[directory] = {
            file,
            source: reader.id,
            maxUpdatedAtMs: records[0]?.updatedAtMs ?? 0,
            count: records.length
          };
        }
        manifestDirty = true;
        syncOptions.onProgress?.({ scannedDirs: stats.scannedDirs, headReads: stats.headReads });
      }
    }

    for (const [directory, shard] of Object.entries(manifest.shards)) {
      if (scannedSources.has(shard.source) && !seenDirectories.has(directory)) {
        stats.removed += shard.count;
        delete manifest.shards[directory];
        manifestDirty = true;
        const unlink = (fs as Partial<UnlinkCapableFileSystem>).unlink;
        if (typeof unlink === "function") {
          await unlink.call(fs, path.join(shardsDir, shard.file)).catch(() => undefined);
        }
      }
    }

    if (manifestDirty) {
      await writeAtomic(manifestPath, JSON.stringify({ ...manifest, version: MANIFEST_VERSION }));
    }
    return stats;
  };

  const query = async (queryOptions: TraceIndexQueryOptions): Promise<TraceReference[]> => {
    const manifest = await loadManifest();
    const sinceMs = queryOptions.since?.getTime();
    const limit = queryOptions.limit;
    const entries = Object.values(manifest.shards)
      .filter(
        (shard) => queryOptions.sources === undefined || queryOptions.sources.includes(shard.source)
      )
      .sort((a, b) => b.maxUpdatedAtMs - a.maxUpdatedAtMs);

    let results: TraceIndexRecord[] = [];
    for (const entry of entries) {
      if (sinceMs !== undefined && entry.maxUpdatedAtMs < sinceMs) {
        break;
      }
      if (results.length >= limit) {
        const cutoff = results[results.length - 1]?.updatedAtMs ?? 0;
        if (entry.maxUpdatedAtMs <= cutoff) {
          break;
        }
      }
      for (const record of await loadShard(entry)) {
        if (sinceMs !== undefined && record.updatedAtMs < sinceMs) {
          continue;
        }
        if (
          queryOptions.allWorkspaces !== true &&
          queryOptions.cwd !== undefined &&
          record.cwd !== queryOptions.cwd
        ) {
          continue;
        }
        results.push(record);
      }
      results.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      if (Number.isFinite(limit) && results.length > limit) {
        results = results.slice(0, limit);
      }
    }
    return results.map(referenceFromRecord);
  };

  const rebuild = async (syncOptions: TraceIndexSyncOptions): Promise<TraceIndexSyncStats> => {
    const unlink = (fs as Partial<UnlinkCapableFileSystem>).unlink;
    if (typeof unlink === "function") {
      const names = await fs.readdir(shardsDir).catch(() => [] as string[]);
      for (const name of names) {
        await unlink.call(fs, path.join(shardsDir, name)).catch(() => undefined);
      }
      await unlink.call(fs, manifestPath).catch(() => undefined);
    } else {
      await writeAtomic(manifestPath, JSON.stringify({ version: MANIFEST_VERSION, shards: {} }));
    }
    return sync(syncOptions);
  };

  return { sync, query, rebuild };
}
