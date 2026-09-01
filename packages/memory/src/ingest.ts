import * as fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "@poe-code/agent-spawn";
import { cacheEnabled, configuredTimeout, resolveAgent } from "@poe-code/poe-code-config/core";
import { UserError } from "@poe-code/user-error";
import { computeIngestKey, readCacheEntry, writeCacheEntry } from "./cache.js";
import { hasOwnErrorCode } from "./errors.js";
import { MEMORY_INDEX_RELPATH } from "./paths.js";
import { reconcile, snapshot } from "./reconcile.js";
import { computeTokenStats } from "./tokens.js";
import type { MemoryConfigOptions } from "@poe-code/poe-code-config/core";
import type { IngestOptions, IngestResult, MemoryRoot } from "./types.js";

export const INGEST_PROMPT_VERSION = "v1";

export type IngestRunners = {
  computeIngestKey?: typeof computeIngestKey;
  readCacheEntry?: typeof readCacheEntry;
  writeCacheEntry?: typeof writeCacheEntry;
  computeTokenStats?: typeof computeTokenStats;
  snapshot?: typeof snapshot;
  reconcile?: typeof reconcile;
};

type ResolvedIngestRunners = {
  computeIngestKey: typeof computeIngestKey;
  readCacheEntry: typeof readCacheEntry;
  writeCacheEntry: typeof writeCacheEntry;
  computeTokenStats: typeof computeTokenStats;
  snapshot: typeof snapshot;
  reconcile: typeof reconcile;
};

function resolveRunners(overrides?: IngestRunners): ResolvedIngestRunners {
  return {
    computeIngestKey: overrides?.computeIngestKey ?? computeIngestKey,
    readCacheEntry: overrides?.readCacheEntry ?? readCacheEntry,
    writeCacheEntry: overrides?.writeCacheEntry ?? writeCacheEntry,
    computeTokenStats: overrides?.computeTokenStats ?? computeTokenStats,
    snapshot: overrides?.snapshot ?? snapshot,
    reconcile: overrides?.reconcile ?? reconcile
  };
}

export async function ingest(
  root: MemoryRoot,
  opts: IngestOptions,
  runners?: IngestRunners
): Promise<IngestResult> {
  const resolved = resolveRunners(runners);
  const source = await materializeSource(opts.source);
  const indexMdBytes = await fs.readFile(path.join(root, MEMORY_INDEX_RELPATH));
  const configOptions = {
    fs: fs as MemoryConfigOptions["fs"],
    filePath: path.join(inferRepoRoot(root), "poe-code.json"),
    projectFilePath: path.join(inferRepoRoot(root), ".poe-code", "config.json")
  } satisfies MemoryConfigOptions;
  const agentId =
    (await resolveAgent(configOptions, opts.agent ?? null)) ?? opts.agent ?? "claude-code";
  const key = resolved.computeIngestKey({
    sourceBytes: source.bytes,
    indexMdBytes,
    promptTemplateVersion: INGEST_PROMPT_VERSION,
    agentId
  });

  if (!opts.force && (await cacheEnabled(configOptions))) {
    const hit = await resolved.readCacheEntry(root, key);
    if (hit !== null) {
      return {
        diff: { created: [], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 0,
        cacheHit: true,
        tokens: await resolved.computeTokenStats(root)
      };
    }
  }

  const prompt = buildIngestPrompt(root, source.label, source.text);
  if (opts.dryRun) {
    console.log(prompt);
    return {
      diff: { created: [], updated: [], deleted: [] },
      exitCode: 0,
      durationMs: 0,
      cacheHit: false,
      tokens: await resolved.computeTokenStats(root)
    };
  }

  const before = await resolved.snapshot(root);

  let exitCode = 1;
  let durationMs = 0;
  let timeoutError: Error | undefined;

  try {
    const controller = new AbortController();
    const result = await runWithTimeout(
      spawn(agentId, { prompt, signal: controller.signal }),
      opts.timeoutMs ?? (await configuredTimeout(configOptions)),
      () => controller.abort()
    );
    exitCode = result.exitCode;
    durationMs = result.durationMs ?? 0;
  } catch (error) {
    timeoutError = error instanceof Error ? error : new Error(String(error));
  }

  const diff = await resolved.reconcile(root, before, "ingest", opts.reason ?? `ingest ${source.label}`);
  const tokens = await resolved.computeTokenStats(root);

  if (timeoutError !== undefined) {
    throw timeoutError;
  }

  if (!opts.noCacheWrite && (await cacheEnabled(configOptions)) && exitCode === 0) {
    await resolved.writeCacheEntry(root, {
      key,
      ingestedAt: new Date().toISOString(),
      sourceLabel: source.label,
      diff,
      exitCode,
      durationMs,
      memoryTokens: tokens.memoryTokens,
      sourceTokens: tokens.sourceTokens,
      promptTemplateVersion: INGEST_PROMPT_VERSION,
      agentId
    });
  }

  return { diff, exitCode, durationMs, cacheHit: false, tokens };
}

function buildIngestPrompt(root: string, sourceLabel: string, sourceText: string): string {
  return [
    `Prompt version: ${INGEST_PROMPT_VERSION}`,
    `Memory root: ${root}`,
    `Source: ${sourceLabel}`,
    "Update memory pages under pages/ only. Do not edit INDEX.md directly.",
    "Add confidence tags to non-trivial claims.",
    "",
    sourceText
  ].join("\n");
}

async function materializeSource(source: IngestOptions["source"]): Promise<{
  label: string;
  bytes: Buffer;
  text: string;
}> {
  if (source.kind === "file") {
    const bytes = await fs.readFile(source.absPath).catch((error: unknown) => {
      if (hasOwnErrorCode(error, "ENOENT")) {
        throw new UserError(`Source not found: ${source.absPath}. Provide a readable file path or an http(s) URL.`);
      }
      throw error;
    });
    return {
      label: source.absPath,
      bytes,
      text: bytes.toString("utf8")
    };
  }

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Unable to fetch memory ingest source (${response.status}): ${source.url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    label: source.url,
    bytes,
    text: bytes.toString("utf8")
  };
}

function inferRepoRoot(root: string): string {
  return path.resolve(root, "..", "..");
}

async function runWithTimeout<T extends { exitCode: number; durationMs?: number }>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`ingest timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
