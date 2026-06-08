import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheStatus = vi.fn();
const clearCache = vi.fn();
const parseDuration = vi.fn();

vi.mock("./cache.js", () => ({
  cacheStatus,
  clearCache
}));

vi.mock("parse-duration", () => ({
  default: parseDuration
}));

const { runMemoryCacheStatus, runMemoryCacheClear } = await import("./cache.cli.js");

describe("runMemoryCacheStatus", () => {
  beforeEach(() => {
    clearCache.mockReset();
    cacheStatus.mockReset();
    parseDuration.mockReset();
  });

  it("prints actual cache entry and byte totals", async () => {
    cacheStatus.mockResolvedValue({ entries: 2, bytes: 42 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMemoryCacheStatus({ root: "/repo/.poe-code/memory" });

    expect(cacheStatus).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(log).toHaveBeenCalledWith("2 cache entries (42 bytes)");
  });
});

describe("runMemoryCacheClear", () => {
  beforeEach(() => {
    clearCache.mockReset();
    parseDuration.mockReset();
  });

  it("requires --yes before clearing the cache", async () => {
    await expect(
      runMemoryCacheClear({
        root: "/repo/.poe-code/memory"
      })
    ).rejects.toThrow("Refusing to clear cache without --yes.");

    expect(clearCache).not.toHaveBeenCalled();
  });

  it("passes an age filter through to clearCache", async () => {
    parseDuration.mockReturnValue(90 * 60 * 1000);
    clearCache.mockResolvedValue({ removed: 3 });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runMemoryCacheClear({
        root: "/repo/.poe-code/memory",
        olderThan: "90m",
        yes: true
      })
    ).resolves.toEqual({ removed: 3 });

    expect(clearCache).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      olderThanMs: 90 * 60 * 1000
    });
    expect(log).toHaveBeenCalledWith("removed 3 cache entr" + "ies");
  });

  it("clears the whole cache when no age filter is provided", async () => {
    clearCache.mockResolvedValue({ removed: 1 });

    await runMemoryCacheClear({
      root: "/repo/.poe-code/memory",
      yes: true
    });

    expect(clearCache).toHaveBeenCalledWith("/repo/.poe-code/memory", {});
  });

  it("logs dry-run cache clears without deleting entries", async () => {
    const log = vi.fn();

    await expect(
      runMemoryCacheClear({
        root: "/repo/.poe-code/memory",
        yes: true,
        dryRun: true,
        log
      })
    ).resolves.toEqual({ removed: 0 });

    expect(clearCache).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Would clear all memory cache entries.");
  });

  it("rejects invalid older-than values", async () => {
    parseDuration.mockReturnValue(null);

    await expect(
      runMemoryCacheClear({
        root: "/repo/.poe-code/memory",
        olderThan: "nonsense",
        yes: true
      })
    ).rejects.toThrow('Invalid duration for --older-than: "nonsense".');
  });
});
