import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const resolveAgent = vi.fn();
const configuredTimeout = vi.fn();
const cacheEnabled = vi.fn();
const computeTokenStats = vi.fn();
const readCacheEntry = vi.fn();
const writeCacheEntry = vi.fn();
const snapshot = vi.fn();
const reconcile = vi.fn();

vi.mock("@poe-code/poe-code-config", () => ({
  resolveAgent,
  configuredTimeout,
  cacheEnabled
}));

vi.mock("./tokens.js", () => ({
  computeTokenStats
}));

vi.mock("./cache.js", () => ({
  computeIngestKey: vi.fn(() => "cache-key"),
  readCacheEntry,
  writeCacheEntry
}));

vi.mock("./reconcile.js", () => ({
  snapshot,
  reconcile
}));

const { ingest, INGEST_PROMPT_VERSION } = await import("./ingest.js");

describe("ingest", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    resolveAgent.mockReset();
    configuredTimeout.mockReset();
    cacheEnabled.mockReset();
    computeTokenStats.mockReset();
    readCacheEntry.mockReset();
    writeCacheEntry.mockReset();
    snapshot.mockReset();
    reconcile.mockReset();

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/notes.md": "# Notes\n",
      "/repo/docs/source.md": "hello world"
    });

    resolveAgent.mockResolvedValue("claude-code");
    configuredTimeout.mockReturnValue(5_000);
    cacheEnabled.mockReturnValue(true);
    computeTokenStats.mockResolvedValue({
      memoryTokens: 10,
      sourceTokens: 100,
      reductionRatio: 10,
      missingSources: []
    });
    readCacheEntry.mockResolvedValue(null);
    snapshot.mockResolvedValue({ pages: {} });
    reconcile.mockResolvedValue({ created: ["pages/new.md"], updated: [], deleted: [] });
  });

  it("returns early on cache hit without spawning", async () => {
    readCacheEntry.mockResolvedValue({ key: "cache-key" });
    const spawnFn = vi.fn();

    const result = await ingest("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      spawnFn
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cacheHit: true, exitCode: 0, durationMs: 0 });
  });

  it("prints the prompt and skips spawning in dry-run mode", async () => {
    const spawnFn = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await ingest("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      dryRun: true,
      spawnFn
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Source: /repo/docs/source.md"));
    expect(result).toMatchObject({ cacheHit: false, exitCode: 0, durationMs: 0 });
  });

  it("spawns, reconciles, and writes cache entries on success", async () => {
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0, durationMs: 123 });

    const result = await ingest("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      reason: "capture docs",
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalledWith(
      "claude-code",
      expect.stringContaining(`Prompt version: ${INGEST_PROMPT_VERSION}`)
    );
    expect(snapshot).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(reconcile).toHaveBeenCalledWith(
      "/repo/.poe-code/memory",
      { pages: {} },
      "ingest",
      "capture docs"
    );
    expect(writeCacheEntry).toHaveBeenCalledWith(
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

    const result = await ingest("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      spawnFn
    });

    expect(reconcile).toHaveBeenCalled();
    expect(writeCacheEntry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 9, durationMs: 45, cacheHit: false });
  });

  it("honors force and no-cache-write", async () => {
    readCacheEntry.mockResolvedValue({ key: "cache-key" });
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0, durationMs: 1 });

    await ingest("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      force: true,
      noCacheWrite: true,
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalled();
    expect(writeCacheEntry).not.toHaveBeenCalled();
  });

  it("fails on timeout after reconciling", async () => {
    configuredTimeout.mockReturnValue(10);
    const spawnFn = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, durationMs: 50 }), 50))
    );

    await expect(
      ingest("/repo/.poe-code/memory", {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        spawnFn
      })
    ).rejects.toThrow("ingest timed out after 10ms");

    expect(reconcile).toHaveBeenCalled();
    expect(writeCacheEntry).not.toHaveBeenCalled();
  });
});
