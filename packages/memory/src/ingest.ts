import * as fs from "node:fs/promises";
import path from "node:path";
import { cacheEnabled, configuredTimeout, resolveAgent } from "@poe-code/poe-code-config";
import { computeIngestKey, readCacheEntry, writeCacheEntry } from "./cache.js";
import { MEMORY_INDEX_RELPATH } from "./paths.js";
import { reconcile, snapshot } from "./reconcile.js";
import { computeTokenStats } from "./tokens.js";
import type { IngestOptions, IngestResult, MemoryRoot, SpawnFn } from "./types.js";
import type { MemoryConfigOptions } from "@poe-code/poe-code-config";

export const INGEST_PROMPT_VERSION = "v1";

type SpawnResult = { exitCode: number; durationMs: number };

export async function ingest(root: MemoryRoot, opts: IngestOptions): Promise<IngestResult> {
  const source = await materializeSource(opts.source);
  const indexMdBytes = await fs.readFile(path.join(root, MEMORY_INDEX_RELPATH));
  const configOptions = {
    fs: fs as MemoryConfigOptions["fs"],
    filePath: path.join(inferRepoRoot(root), "poe-code.json")
  } satisfies MemoryConfigOptions;
  const agentId =
    (await resolveAgent(configOptions, opts.agent ?? null)) ?? opts.agent ?? "claude-code";
  const key = computeIngestKey({
    sourceBytes: source.bytes,
    indexMdBytes,
    promptTemplateVersion: INGEST_PROMPT_VERSION,
    agentId
  });

  if (!opts.force && (await cacheEnabled(configOptions))) {
    const hit = await readCacheEntry(root, key);
    if (hit !== null) {
      return {
        diff: { created: [], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 0,
        cacheHit: true,
        tokens: await computeTokenStats(root)
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
      tokens: await computeTokenStats(root)
    };
  }

  const before = await snapshot(root);

  let exitCode = 1;
  let durationMs = 0;
  let timeoutError: Error | undefined;

  try {
    const spawnFn = opts.spawnFn as SpawnFn<SpawnResult> | undefined;
    const result = await runWithTimeout(
      spawnFn?.(agentId, prompt) ?? Promise.resolve({ exitCode: 0, durationMs: 0 }),
      opts.timeoutMs ?? (await configuredTimeout(configOptions))
    );
    exitCode = result.exitCode;
    durationMs = result.durationMs;
  } catch (error) {
    timeoutError = error instanceof Error ? error : new Error(String(error));
  }

  const diff = await reconcile(root, before, "ingest", opts.reason ?? `ingest ${source.label}`);
  const tokens = await computeTokenStats(root);

  if (timeoutError !== undefined) {
    throw timeoutError;
  }

  if (!opts.noCacheWrite && (await cacheEnabled(configOptions)) && exitCode === 0) {
    await writeCacheEntry(root, {
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
    const bytes = await fs.readFile(source.absPath);
    return {
      label: source.absPath,
      bytes,
      text: bytes.toString("utf8")
    };
  }

  throw new Error("URL ingest not implemented yet.");
}

function inferRepoRoot(root: string): string {
  return path.resolve(root, "..", "..");
}

async function runWithTimeout<T extends { exitCode: number; durationMs: number }>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
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
