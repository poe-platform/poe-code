import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import type { computeIngestKey, readCacheEntry, writeCacheEntry } from "./cache.js";
import type { snapshot, reconcile } from "./reconcile.js";
import type { computeTokenStats } from "./tokens.js";
import type { IngestCacheEntry } from "./types.js";
import { ingest, INGEST_PROMPT_VERSION, type IngestRunners } from "./ingest.js";

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { resolveAgent, configuredTimeout, cacheEnabled } = vi.hoisted(() => ({
  resolveAgent: vi.fn(),
  configuredTimeout: vi.fn(),
  cacheEnabled: vi.fn()
}));

vi.mock("@poe-code/poe-code-config", () => ({
  resolveAgent,
  configuredTimeout,
  cacheEnabled
}));

const computeIngestKeyMock = vi.fn<typeof computeIngestKey>();
const readCacheEntryMock = vi.fn<typeof readCacheEntry>();
const writeCacheEntryMock = vi.fn<typeof writeCacheEntry>();
const computeTokenStatsMock = vi.fn<typeof computeTokenStats>();
const snapshotMock = vi.fn<typeof snapshot>();
const reconcileMock = vi.fn<typeof reconcile>();

const runners: IngestRunners = {
  computeIngestKey: computeIngestKeyMock,
  readCacheEntry: readCacheEntryMock,
  writeCacheEntry: writeCacheEntryMock,
  computeTokenStats: computeTokenStatsMock,
  snapshot: snapshotMock,
  reconcile: reconcileMock
};

describe("ingest", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    resolveAgent.mockReset();
    configuredTimeout.mockReset();
    cacheEnabled.mockReset();
    computeIngestKeyMock.mockReset();
    readCacheEntryMock.mockReset();
    writeCacheEntryMock.mockReset();
    computeTokenStatsMock.mockReset();
    snapshotMock.mockReset();
    reconcileMock.mockReset();

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/notes.md": "# Notes\n",
      "/repo/docs/source.md": "hello world"
    });

    resolveAgent.mockResolvedValue("claude-code");
    configuredTimeout.mockReturnValue(5_000);
    cacheEnabled.mockReturnValue(true);
    computeIngestKeyMock.mockReturnValue("cache-key");
    computeTokenStatsMock.mockResolvedValue({
      memoryTokens: 10,
      sourceTokens: 100,
      reductionRatio: 10,
      missingSources: []
    });
    readCacheEntryMock.mockResolvedValue(null);
    snapshotMock.mockResolvedValue({ pages: {} });
    reconcileMock.mockResolvedValue({ created: ["pages/new.md"], updated: [], deleted: [] });
  });

  it("returns early on cache hit without spawning", async () => {
    readCacheEntryMock.mockResolvedValue({ key: "cache-key" } as IngestCacheEntry);
    const spawnFn = vi.fn();

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        spawnFn
      },
      runners
    );

    expect(spawnFn).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cacheHit: true, exitCode: 0, durationMs: 0 });
  });

  it("prints the prompt and skips spawning in dry-run mode", async () => {
    const spawnFn = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        dryRun: true,
        spawnFn
      },
      runners
    );

    expect(spawnFn).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Source: /repo/docs/source.md"));
    expect(result).toMatchObject({ cacheHit: false, exitCode: 0, durationMs: 0 });
  });

  it("spawns, reconciles, and writes cache entries on success", async () => {
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0, durationMs: 123 });

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        reason: "capture docs",
        spawnFn
      },
      runners
    );

    expect(spawnFn).toHaveBeenCalledWith(
      "claude-code",
      expect.stringContaining(`Prompt version: ${INGEST_PROMPT_VERSION}`)
    );
    expect(snapshotMock).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(reconcileMock).toHaveBeenCalledWith(
      "/repo/.poe-code/memory",
      { pages: {} },
      "ingest",
      "capture docs"
    );
    expect(writeCacheEntryMock).toHaveBeenCalledWith(
      "/repo/.poe-code/memory",
      expect.objectContaining({
        key: "cache-key",
        sourceLabel: "/repo/docs/source.md",
        diff: { created: ["pages/new.md"], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 123,
        promptTemplateVersion: INGEST_PROMPT_VERSION,
        agentId: "claude-code",
        memoryTokens: 10,
        sourceTokens: 100
      })
    );
    expect(result).toMatchObject({
      cacheHit: false,
      exitCode: 0,
      durationMs: 123,
      diff: { created: ["pages/new.md"], updated: [], deleted: [] }
    });
  });

  it("reconciles after spawn failure and skips cache writes", async () => {
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 9, durationMs: 45 });

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        spawnFn
      },
      runners
    );

    expect(reconcileMock).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 9, durationMs: 45, cacheHit: false });
  });

  it("honors force and no-cache-write", async () => {
    readCacheEntryMock.mockResolvedValue({ key: "cache-key" } as IngestCacheEntry);
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0, durationMs: 1 });

    await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        force: true,
        noCacheWrite: true,
        spawnFn
      },
      runners
    );

    expect(spawnFn).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
  });

  it("fails on timeout after reconciling", async () => {
    configuredTimeout.mockReturnValue(10);
    const spawnFn = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, durationMs: 50 }), 50))
    );

    await expect(
      ingest(
        "/repo/.poe-code/memory",
        {
          source: { kind: "file", absPath: "/repo/docs/source.md" },
          spawnFn
        },
        runners
      )
    ).rejects.toThrow("ingest timed out after 10ms");

    expect(reconcileMock).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
  });
});
