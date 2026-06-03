import parseDuration from "parse-duration";
import { cacheStatus, clearCache } from "./cache.js";
import type { MemoryRoot } from "./types.js";

export async function runMemoryCacheStatus(input: { root: MemoryRoot }): Promise<void> {
  const status = await cacheStatus(input.root);
  console.log(`${status.entries} cache ${status.entries === 1 ? "entry" : "entries"} (${status.bytes} bytes)`);
}

export async function runMemoryCacheClear(input: {
  root: MemoryRoot;
  olderThan?: string;
  yes?: boolean;
}): Promise<{ removed: number }> {
  if (!input.yes) {
    throw new Error("Refusing to clear cache without --yes.");
  }

  const olderThanMs = parseOlderThan(input.olderThan);
  const result = await clearCache(input.root, olderThanMs === undefined ? {} : { olderThanMs });
  console.log(`removed ${result.removed} cache ${result.removed === 1 ? "entry" : "entries"}`);
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
