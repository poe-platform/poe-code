import parseDuration from "parse-duration";
import { cacheStatus, clearCache } from "./cache.js";
import type { MemoryRoot } from "./types.js";

type CacheLog = (message: string) => void;

export async function runMemoryCacheStatus(input: {
  root: MemoryRoot;
  log?: CacheLog;
}): Promise<void> {
  const status = await cacheStatus(input.root);
  const log = input.log ?? console.log;
  log(`${status.entries} cache ${status.entries === 1 ? "entry" : "entries"} (${status.bytes} bytes)`);
}

export async function runMemoryCacheClear(input: {
  root: MemoryRoot;
  olderThan?: string;
  yes?: boolean;
  dryRun?: boolean;
  log?: CacheLog;
}): Promise<{ removed: number }> {
  if (!input.yes) {
    throw new Error("Refusing to clear cache without --yes.");
  }

  const olderThanMs = parseOlderThan(input.olderThan);
  const log = input.log ?? console.log;
  if (input.dryRun === true) {
    log(formatDryRunMessage(input.olderThan));
    return { removed: 0 };
  }

  const result = await clearCache(input.root, olderThanMs === undefined ? {} : { olderThanMs });
  log(`removed ${result.removed} cache ${result.removed === 1 ? "entry" : "entries"}`);
  return result;
}

function parseOlderThan(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const duration = parseDuration(value);
  if (duration === null || Number.isNaN(duration) || duration < 0) {
    throw new Error(`Invalid duration for --older-than: "${value}".`);
  }

  return duration;
}

function formatDryRunMessage(olderThan: string | undefined): string {
  if (olderThan === undefined) {
    return "Would clear all memory cache entries.";
  }
  return `Would clear memory cache entries older than ${olderThan}.`;
}
