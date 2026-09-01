import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import type { computeIngestKey, readCacheEntry, writeCacheEntry } from "./cache.js";
import type { snapshot, reconcile } from "./reconcile.js";
import type { computeTokenStats } from "./tokens.js";
import type { IngestCacheEntry } from "./types.js";
import { ingest, INGEST_PROMPT_VERSION, type IngestRunners } from "./ingest.js";

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined
}));

vi.mock("@poe-code/agent-spawn", () => {
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return spawnMock.factory();
});

const { resolveAgent, configuredTimeout, cacheEnabled } = vi.hoisted(() => ({
  resolveAgent: vi.fn(),
  configuredTimeout: vi.fn(),
  cacheEnabled: vi.fn()
}));

vi.mock("@poe-code/poe-code-config/core", () => ({
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
    vi.unstubAllGlobals();
    resolveAgent.mockReset();
    configuredTimeout.mockReset();
    cacheEnabled.mockReset();
    computeIngestKeyMock.mockReset();
    readCacheEntryMock.mockReset();
    writeCacheEntryMock.mockReset();
    computeTokenStatsMock.mockReset();
    snapshotMock.mockReset();
    reconcileMock.mockReset();
    mockedAgentSpawn.spawnMock!.spawn.mockReset();

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

    const result = await ingest(
      "/repo/.poe-code/memory",
      { source: { kind: "file", absPath: "/repo/docs/source.md" } },
      runners
    );

    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cacheHit: true, exitCode: 0, durationMs: 0 });
  });

  it("loads ingest settings from project configuration", async () => {
    await ingest(
      "/repo/.poe-code/memory",
      { source: { kind: "file", absPath: "/repo/docs/source.md" } },
      runners
    );

    expect(resolveAgent.mock.calls[0]?.[0].filePath).toBe("/repo/poe-code.json");
    expect(resolveAgent.mock.calls[0]?.[0].projectFilePath).toBe("/repo/.poe-code/config.json");
    expect(cacheEnabled.mock.calls[0]?.[0].projectFilePath).toBe("/repo/.poe-code/config.json");
    expect(configuredTimeout.mock.calls[0]?.[0].projectFilePath).toBe("/repo/.poe-code/config.json");
  });

  it("prints the prompt and skips spawning in dry-run mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        dryRun: true
      },
      runners
    );

    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Source: /repo/docs/source.md"));
    expect(result).toMatchObject({ cacheHit: false, exitCode: 0, durationMs: 0 });
  });

  it("materializes URL sources for dry-run ingest", async () => {
    const fetchMock = vi.fn(async () => new Response("remote notes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "url", url: "https://example.test/notes.md" },
        dryRun: true
      },
      runners
    );

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/notes.md");
    expect(computeIngestKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBytes: Buffer.from("remote notes") })
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Source: https://example.test/notes.md"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("remote notes"));
    expect(result).toMatchObject({ cacheHit: false, exitCode: 0, durationMs: 0 });
  });

  it("names the missing file as a user error instead of leaking ENOENT", async () => {
    const rejection = await ingest(
      "/repo/.poe-code/memory",
      { source: { kind: "file", absPath: "/repo/docs/absent.md" }, dryRun: true },
      runners
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe("UserError");
    expect((rejection as Error).message).toContain("/repo/docs/absent.md");
    expect((rejection as Error).message).not.toContain("ENOENT");
    expect(computeIngestKeyMock).not.toHaveBeenCalled();
    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
  });

  it("rejects failed URL source responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

    await expect(
      ingest(
        "/repo/.poe-code/memory",
        {
          source: { kind: "url", url: "https://example.test/missing.md" },
          dryRun: true
        },
        runners
      )
    ).rejects.toThrow("Unable to fetch memory ingest source (404)");

    expect(computeIngestKeyMock).not.toHaveBeenCalled();
    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
  });

  it("spawns, reconciles, and writes cache entries on success", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      exitCode: 0,
      durationMs: 123,
      stdout: "",
      stderr: ""
    });

    const result = await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        reason: "capture docs"
      },
      runners
    );

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining(`Prompt version: ${INGEST_PROMPT_VERSION}`)
      })
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
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      exitCode: 9,
      durationMs: 45,
      stdout: "",
      stderr: ""
    });

    const result = await ingest(
      "/repo/.poe-code/memory",
      { source: { kind: "file", absPath: "/repo/docs/source.md" } },
      runners
    );

    expect(reconcileMock).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 9, durationMs: 45, cacheHit: false });
  });

  it("honors force and no-cache-write", async () => {
    readCacheEntryMock.mockResolvedValue({ key: "cache-key" } as IngestCacheEntry);
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      exitCode: 0,
      durationMs: 1,
      stdout: "",
      stderr: ""
    });

    await ingest(
      "/repo/.poe-code/memory",
      {
        source: { kind: "file", absPath: "/repo/docs/source.md" },
        force: true,
        noCacheWrite: true
      },
      runners
    );

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
  });

  it("aborts the running agent on timeout before reconciling", async () => {
    configuredTimeout.mockReturnValue(10);
    let signal: AbortSignal | undefined;
    mockedAgentSpawn.spawnMock!.spawn.mockImplementationOnce((_agentId, options) => {
      signal = options.signal;
      return new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, durationMs: 50 }), 50));
    });

    await expect(
      ingest(
        "/repo/.poe-code/memory",
        { source: { kind: "file", absPath: "/repo/docs/source.md" } },
        runners
      )
    ).rejects.toThrow("ingest timed out after 10ms");

    expect(signal?.aborted).toBe(true);
    expect(reconcileMock).toHaveBeenCalled();
    expect(writeCacheEntryMock).not.toHaveBeenCalled();
  });
});
