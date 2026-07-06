import { createHash } from "node:crypto";
import path from "node:path";
import { resolveCacheDir } from "@poe-code/cached-resource";
import type { AgentTraceFileSystem } from "@poe-code/agent-traces";
import type { ContextBreakdown } from "./types.js";

const CACHE_VERSION = 2;

export interface TraceFileIdentity {
  mtimeMs: number;
  size: number;
}

interface TokenCacheEntry {
  version: number;
  mtimeMs: number;
  size: number;
  breakdown: ContextBreakdown;
}

export function defaultTraceTokenCacheDir(): string {
  return path.join(resolveCacheDir("poe-code"), "trace-tokens");
}

export async function traceFileIdentity(
  fs: AgentTraceFileSystem,
  filePath: string
): Promise<TraceFileIdentity | undefined> {
  try {
    const stats = await fs.stat(filePath);
    const mtimeMs = stats.mtime instanceof Date ? stats.mtime.getTime() : undefined;
    if (mtimeMs === undefined || Number.isNaN(mtimeMs) || typeof stats.size !== "number") {
      return undefined;
    }
    return { mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
}

export async function readCachedBreakdown(
  fs: AgentTraceFileSystem,
  cacheDir: string,
  filePath: string,
  identity: TraceFileIdentity
): Promise<ContextBreakdown | undefined> {
  let entry: TokenCacheEntry;
  try {
    entry = JSON.parse(await fs.readFile(cacheFilePath(cacheDir, filePath), "utf8"));
  } catch {
    return undefined;
  }

  if (
    entry.version !== CACHE_VERSION ||
    entry.mtimeMs !== identity.mtimeMs ||
    entry.size !== identity.size ||
    typeof entry.breakdown?.measuredTokens !== "number" ||
    entry.breakdown.source !== "exact"
  ) {
    return undefined;
  }

  return entry.breakdown;
}

export async function writeCachedBreakdown(
  fs: AgentTraceFileSystem,
  cacheDir: string,
  filePath: string,
  identity: TraceFileIdentity,
  breakdown: ContextBreakdown
): Promise<void> {
  const entry: TokenCacheEntry = {
    version: CACHE_VERSION,
    mtimeMs: identity.mtimeMs,
    size: identity.size,
    breakdown
  };
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFilePath(cacheDir, filePath), JSON.stringify(entry));
  } catch {
    // Token caching is best-effort; recomputing on the next view is always safe.
  }
}

function cacheFilePath(cacheDir: string, filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
  return path.join(cacheDir, `${hash}.json`);
}
