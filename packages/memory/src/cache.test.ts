import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { cacheStatus, clearCache, computeIngestKey, readCacheEntry, writeCacheEntry } = await import("./cache.js");

const baseEntry = {
  key: "abc123",
  ingestedAt: "2026-04-19T10:00:00.000Z",
  sourceLabel: "docs/memory.md",
  diff: {
    created: ["pages/new-page.md"],
    updated: ["pages/architecture.md"],
    deleted: []
  },
  exitCode: 0,
  durationMs: 1234,
  memoryTokens: 120,
  sourceTokens: 840,
  promptTemplateVersion: "v1",
  agentId: "claude-code@1.2.3"
} as const;

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("computeIngestKey", () => {
  it("is deterministic and separates each cache-key component", () => {
    const left = computeIngestKey({
      sourceBytes: Buffer.from("ab"),
      indexMdBytes: Buffer.from("c"),
      promptTemplateVersion: "d",
      agentId: "e"
    });

    const right = computeIngestKey({
      sourceBytes: Buffer.from("a"),
      indexMdBytes: Buffer.from("bc"),
      promptTemplateVersion: "d",
      agentId: "e"
    });

    expect(left).toHaveLength(64);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computeIngestKey({
        sourceBytes: Buffer.from("ab"),
        indexMdBytes: Buffer.from("c"),
        promptTemplateVersion: "d",
        agentId: "e"
      })
    ).toBe(left);
    expect(right).not.toBe(left);
  });
});

describe("readCacheEntry and writeCacheEntry", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a cache entry into the ingest cache directory and reads it back", async () => {
    await writeCacheEntry("/repo/.poe-code/memory", baseEntry);

    await expect(
      vol.promises.readFile("/repo/.poe-code/memory/.cache/ingest/abc123.json", "utf8")
    ).resolves.toContain('"sourceLabel":"docs/memory.md"');

    await expect(readCacheEntry("/repo/.poe-code/memory", "abc123")).resolves.toEqual(baseEntry);
  });

  it("rejects writes through symlinked memory root ancestors", async () => {
    vol.fromJSON({
      "/repo/.keep": "",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code");

    await expect(writeCacheEntry("/repo/.poe-code/memory", baseEntry)).rejects.toThrow(
      /symbolic link/i
    );
    await expect(vol.promises.stat("/outside/memory/.cache/ingest/abc123.json")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects reads through a symlinked cache directory", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.keep": "",
      "/outside/ingest/abc123.json": JSON.stringify(baseEntry)
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/.cache");

    await expect(readCacheEntry("/repo/.poe-code/memory", "abc123")).rejects.toThrow(
      /symbolic link/i
    );
  });

  it("rejects writes through a symlinked ingest cache directory", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/.keep": "",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/.cache/ingest");

    await expect(writeCacheEntry("/repo/.poe-code/memory", baseEntry)).rejects.toThrow(
      /symbolic link/i
    );
    await expect(vol.promises.stat("/outside/abc123.json")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("returns null when the cache entry does not exist", async () => {
    await expect(readCacheEntry("/repo/.poe-code/memory", "missing")).resolves.toBeNull();
  });

  it("does not treat inherited filesystem error codes as missing cache entries", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/.keep": ""
    });
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (filePath, options) => {
      if (String(filePath).endsWith("/abc123.json")) {
        throw new Error("cache permission denied");
      }

      return readFile(filePath, options);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(readCacheEntry("/repo/.poe-code/memory", "abc123")).rejects.toThrow(
        "cache permission denied"
      );
    });
  });

  it("returns null and warns when the cache entry JSON is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/bad.json": "{not valid json"
    });

    await expect(readCacheEntry("/repo/.poe-code/memory", "bad")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Ignoring ingest cache entry "bad":');
  });

  it("returns null and warns when the cache entry shape is invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/bad-shape.json": JSON.stringify({
        key: "bad-shape",
        diff: { created: [], updated: [], deleted: [] }
      })
    });

    await expect(readCacheEntry("/repo/.poe-code/memory", "bad-shape")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Ignoring ingest cache entry "bad-shape": Expected string at "ingestedAt".'
    );
  });

  it("returns null and warns when cache entry fields are inherited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/abc123.json": "{}"
    });

    await withObjectPrototypeProperties(baseEntry as unknown as Record<string, unknown>, async () => {
      await expect(readCacheEntry("/repo/.poe-code/memory", "abc123")).resolves.toBeNull();
    });
    expect(warn).toHaveBeenCalledWith(
      'Ignoring ingest cache entry "abc123": Expected string at "key".'
    );
  });

  it("rejects traversal cache keys before reading or writing", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/victim/secret.json": JSON.stringify(baseEntry)
    });

    await expect(readCacheEntry("/repo/.poe-code/memory", "../../victim/secret")).rejects.toThrow(
      "cannot escape"
    );
    await expect(
      writeCacheEntry("/repo/.poe-code/memory", {
        ...baseEntry,
        key: "../../victim/written"
      })
    ).rejects.toThrow("cannot escape");
    await expect(vol.promises.stat("/repo/.poe-code/memory/victim/written.json")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves a prior cache hit when refresh persistence fails", async () => {
    const cachePath = "/repo/.poe-code/memory/.cache/ingest/abc123.json";
    vol.fromJSON({ [cachePath]: `${JSON.stringify(baseEntry)}\n` });
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).startsWith(cachePath)) {
        vol.writeFileSync(String(filePath), "{");
        throw new Error("cache disk full");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(
      writeCacheEntry("/repo/.poe-code/memory", { ...baseEntry, sourceLabel: "updated" })
    ).rejects.toThrow("cache disk full");
    await expect(readCacheEntry("/repo/.poe-code/memory", "abc123")).resolves.toEqual(baseEntry);
  });
});

describe("clearCache", () => {
  beforeEach(() => {
    vol.reset();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns zero when the cache directory does not exist", async () => {
    await expect(clearCache("/repo/.poe-code/memory")).resolves.toEqual({ removed: 0 });
  });

  it("removes the whole cache directory when no age filter is provided", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/first.json": JSON.stringify(baseEntry),
      "/repo/.poe-code/memory/.cache/ingest/second.json": JSON.stringify({
        ...baseEntry,
        key: "second"
      })
    });

    await expect(clearCache("/repo/.poe-code/memory")).resolves.toEqual({ removed: 2 });
    await expect(vol.promises.stat("/repo/.poe-code/memory/.cache")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes only entries older than the requested age", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/old.json": JSON.stringify({
        ...baseEntry,
        key: "old",
        ingestedAt: "2026-04-19T09:00:00.000Z"
      }),
      "/repo/.poe-code/memory/.cache/ingest/new.json": JSON.stringify({
        ...baseEntry,
        key: "new",
        ingestedAt: "2026-04-19T11:30:00.000Z"
      })
    });

    await expect(clearCache("/repo/.poe-code/memory", { olderThanMs: 60 * 60 * 1000 })).resolves.toEqual({
      removed: 1
    });

    await expect(vol.promises.stat("/repo/.poe-code/memory/.cache/ingest/old.json")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.readFile("/repo/.poe-code/memory/.cache/ingest/new.json", "utf8")).resolves.toContain(
      '"key":"new"'
    );
  });

  it("rejects filtered cleanup through a symlinked ingest cache directory", async () => {
    const externalEntry = JSON.stringify({
      ...baseEntry,
      key: "old",
      ingestedAt: "2026-04-19T09:00:00.000Z"
    });
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/.keep": "",
      "/outside/old.json": externalEntry
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/.cache/ingest");

    await expect(
      clearCache("/repo/.poe-code/memory", { olderThanMs: 60 * 60 * 1000 })
    ).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.readFile("/outside/old.json", "utf8")).resolves.toBe(
      externalEntry
    );
  });

  it("restores earlier expired entries when a later filtered removal fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/.cache/ingest/a.json`]: JSON.stringify({ ...baseEntry, key: "a", ingestedAt: "2026-04-19T09:00:00.000Z" }),
      [`${root}/.cache/ingest/b.json`]: JSON.stringify({ ...baseEntry, key: "b", ingestedAt: "2026-04-19T09:00:00.000Z" })
    });
    const remove = vol.promises.rm.bind(vol.promises);
    vi.spyOn(vol.promises, "rm").mockImplementation(async (filePath, options) => {
      if (String(filePath).endsWith("/b.json")) {
        throw new Error("injected second removal failure");
      }

      return remove(filePath, options);
    });

    await expect(clearCache(root, { olderThanMs: 60 * 60 * 1000 })).rejects.toThrow(
      "injected second removal failure"
    );
    await expect(vol.promises.readFile(`${root}/.cache/ingest/a.json`, "utf8")).resolves.toContain('"key":"a"');
    await expect(vol.promises.readFile(`${root}/.cache/ingest/b.json`, "utf8")).resolves.toContain('"key":"b"');
  });
});

describe("cacheStatus", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("reports ingest cache entry count and total bytes", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/ingest/a.json": "abc",
      "/repo/.poe-code/memory/.cache/ingest/b.json": "12345",
      "/repo/.poe-code/memory/.cache/ingest/ignore.txt": "ignored"
    });

    await expect(cacheStatus("/repo/.poe-code/memory")).resolves.toEqual({ entries: 2, bytes: 8 });
  });

  it("rejects status through a symlinked ingest cache directory", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/.cache/.keep": "",
      "/outside/a.json": "abc"
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/.cache/ingest");

    await expect(cacheStatus("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
  });
});
