import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadCachedOpenApiSource } from "./spec-cache.js";

const SOURCE_URL = new URL("https://example.com/openapi.json");
const SPEC_TEXT = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Example", version: "1.0.0" },
  paths: {}
});

function createServices() {
  const volume = Volume.fromJSON({}, "/");
  return {
    fs: createFsFromVolume(volume).promises,
    volume
  };
}

function findCacheFile(volume: Volume): string {
  const cacheFiles = Object.keys(volume.toJSON()).filter((filePath) => filePath.endsWith(".json"));
  expect(cacheFiles).toHaveLength(1);
  const cacheFile = cacheFiles[0];
  if (cacheFile === undefined) {
    throw new Error("Expected one cache file.");
  }
  return cacheFile;
}

async function commitSource(source: Awaited<ReturnType<typeof loadCachedOpenApiSource>>) {
  expect(source.commit).toBeTypeOf("function");
  await source.commit?.();
}

describe("loadCachedOpenApiSource", () => {
  it("uses a fresh disk cache without making another request", async () => {
    const { fs } = createServices();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(SPEC_TEXT, {
        headers: { etag: '"spec-v1"' }
      })
    );
    const options = {
      cache: { directory: "/cache", maxAgeMs: 60_000 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const second = await loadCachedOpenApiSource(SOURCE_URL, options);

    expect(second.sourceText).toBe(SPEC_TEXT);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("revalidates stale entries with If-None-Match and accepts 304", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(SPEC_TEXT, {
          headers: { etag: '"spec-v1"' }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const second = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(second);

    const request = fetch.mock.calls[1]?.[1];
    expect(new Headers(request?.headers).get("if-none-match")).toBe('"spec-v1"');
    expect(second.sourceText).toBe(SPEC_TEXT);
  });

  it("ignores a malformed cached ETag and refreshes without a validator", async () => {
    const { fs, volume } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(SPEC_TEXT, {
          headers: { etag: '"spec-v1"' }
        })
      )
      .mockResolvedValueOnce(new Response(SPEC_TEXT));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const cacheFile = findCacheFile(volume);
    const entry = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    entry.etag = "invalid\nvalue";
    await fs.writeFile(cacheFile, JSON.stringify(entry));

    await loadCachedOpenApiSource(SOURCE_URL, options);

    const request = fetch.mock.calls[1]?.[1];
    expect(new Headers(request?.headers).get("if-none-match")).toBeNull();
  });

  it("rejects 304 when no conditional validator was sent", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).rejects.toThrow(
      "received 304 without a cached validator"
    );
  });

  it.each(["no-cache", "max-age=0", 'max-age="0"'])(
    "honors Cache-Control: %s over the configured fallback freshness",
    async (cacheControl) => {
      const { fs } = createServices();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          new Response(SPEC_TEXT, {
            headers: {
              "cache-control": cacheControl,
              etag: '"spec-v1"'
            }
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 304 }))
        .mockResolvedValueOnce(new Response(null, { status: 304 }));
      const options = {
        cache: { directory: "/cache", maxAgeMs: 60_000 },
        fetch,
        fs,
        timeoutMs: 100
      };

      const first = await loadCachedOpenApiSource(SOURCE_URL, options);
      await commitSource(first);
      const second = await loadCachedOpenApiSource(SOURCE_URL, options);
      await commitSource(second);
      await loadCachedOpenApiSource(SOURCE_URL, options);

      expect(fetch).toHaveBeenCalledTimes(3);
    }
  );

  it("subtracts the response Age from server freshness", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(SPEC_TEXT, {
          headers: {
            age: "60",
            "cache-control": 'max-age="60"',
            etag: '"spec-v1"'
          }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 60_000 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    await loadCachedOpenApiSource(SOURCE_URL, options);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("applies Age when a 304 omits unchanged Cache-Control metadata", async () => {
    const { fs, volume } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(SPEC_TEXT, {
          headers: {
            "cache-control": "max-age=60",
            etag: '"spec-v1"'
          }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { age: "59" } }));
    const options = {
      cache: { directory: "/cache" },
      fetch,
      fs,
      timeoutMs: 100
    };
    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const cacheFile = findCacheFile(volume);
    const staleEntry = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    staleEntry.validatedAt = Date.now() - 60_000;
    await fs.writeFile(cacheFile, JSON.stringify(staleEntry));

    const revalidated = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(revalidated);

    const revalidatedEntry = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    expect(revalidatedEntry.maxAgeMs).toBe(1_000);
  });

  it("uses the last-known-good entry when the refresh is offline", async () => {
    const { fs } = createServices();
    const onFallback = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(SPEC_TEXT, {
          headers: { etag: '"spec-v1"' }
        })
      )
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: { code: "ENOTFOUND", address: "example.com" }
        })
      );
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0, onFallback },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const fallback = await loadCachedOpenApiSource(SOURCE_URL, options);

    expect(fallback.sourceText).toBe(SPEC_TEXT);
    expect(onFallback).toHaveBeenCalledWith(
      expect.stringContaining("Using cached OpenAPI document")
    );
  });

  it("uses the last-known-good entry when a successful response body disconnects", async () => {
    const { fs } = createServices();
    const disconnectedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
      }
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockResolvedValueOnce(new Response(disconnectedBody));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };
    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).resolves.toMatchObject({
      sourceText: SPEC_TEXT
    });
  });

  it("bounds refresh latency and falls back after a timeout", async () => {
    const { fs } = createServices();
    const onFallback = vi.fn();
    const onTimeout = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          })
      );
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0, onFallback },
      fetch,
      fs,
      onTimeout,
      timeoutMs: 5
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const fallback = await loadCachedOpenApiSource(SOURCE_URL, options);

    expect(fallback.sourceText).toBe(SPEC_TEXT);
    expect(onTimeout).toHaveBeenCalledWith({
      source: SOURCE_URL.toString(),
      timeoutMs: 5,
      usingCachedDocument: true
    });
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("timed out after 5ms"));
  });

  it("reports the configured timeout when no cached entry exists", async () => {
    const { fs } = createServices();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
    );
    const onTimeout = vi.fn();

    await expect(
      loadCachedOpenApiSource(SOURCE_URL, {
        cache: false,
        fetch,
        fs,
        onTimeout,
        timeoutMs: 5
      })
    ).rejects.toThrow("Request timed out after 5ms: https://example.com/openapi.json.");
    expect(onTimeout).toHaveBeenCalledWith({
      source: SOURCE_URL.toString(),
      timeoutMs: 5,
      usingCachedDocument: false
    });
  });

  it("times out while reading a stalled response body", async () => {
    const { fs } = createServices();
    const onTimeout = vi.fn();
    let requestSignal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start: () => undefined }));
    });

    await expect(
      loadCachedOpenApiSource(SOURCE_URL, {
        cache: false,
        fetch,
        fs,
        onTimeout,
        timeoutMs: 5
      })
    ).rejects.toThrow("Request timed out after 5ms");
    expect(requestSignal?.aborted).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("keeps a future-dated entry available for offline fallback", async () => {
    const { fs, volume } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 60_000 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const cacheFile = findCacheFile(volume);
    const entry = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    entry.validatedAt = Date.now() + 60_000;
    await fs.writeFile(cacheFile, JSON.stringify(entry));

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).resolves.toMatchObject({
      sourceText: SPEC_TEXT
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not write through a symlinked cache directory", async () => {
    const { fs: baseFs, volume } = createServices();
    await baseFs.mkdir("/outside", { recursive: true });
    await baseFs.symlink("/outside", "/cache", "dir");
    const fs = {
      ...baseFs,
      mkdir: vi.fn(
        async (directoryPath: string, options?: { recursive?: boolean; mode?: number }) => {
          if (directoryPath !== "/cache") {
            await baseFs.mkdir(directoryPath, options);
          }
        }
      )
    };
    const source = await loadCachedOpenApiSource(SOURCE_URL, {
      cache: { directory: "/cache" },
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(SPEC_TEXT)),
      fs,
      timeoutMs: 100
    });

    await source.commit?.();

    expect(
      Object.keys(volume.toJSON()).filter((filePath) => filePath.startsWith("/outside/"))
    ).toEqual([]);
  });

  it("ignores a cache file symlinked outside its directory", async () => {
    const { fs, volume } = createServices();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(SPEC_TEXT));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 60_000 },
      fetch,
      fs,
      timeoutMs: 100
    };
    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const cacheFile = findCacheFile(volume);
    const cacheContents = await fs.readFile(cacheFile, "utf8");
    await fs.unlink(cacheFile);
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/cache.json", cacheContents);
    await fs.symlink("/outside/cache.json", cacheFile, "file");

    await loadCachedOpenApiSource(SOURCE_URL, options);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cleans up a partially written temporary cache file", async () => {
    const { fs: baseFs, volume } = createServices();
    const fs = {
      ...baseFs,
      writeFile: vi.fn(async (...args: Parameters<typeof baseFs.writeFile>) => {
        await baseFs.writeFile(...args);
        throw Object.assign(new Error("disk failure"), { code: "EIO" });
      })
    };
    const source = await loadCachedOpenApiSource(SOURCE_URL, {
      cache: { directory: "/cache" },
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(SPEC_TEXT)),
      fs,
      timeoutMs: 100
    });

    await source.commit?.();

    expect(Object.keys(volume.toJSON()).filter((filePath) => filePath.endsWith(".tmp"))).toEqual(
      []
    );
  });

  it("does not write through a symlinked cache-directory ancestor", async () => {
    const { fs, volume } = createServices();
    await fs.mkdir("/outside", { recursive: true });
    await fs.symlink("/outside", "/redirect", "dir");
    const source = await loadCachedOpenApiSource(SOURCE_URL, {
      cache: { directory: "/redirect/specs" },
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(SPEC_TEXT)),
      fs,
      timeoutMs: 100
    });

    await source.commit?.();

    expect(Object.keys(volume.toJSON()).filter((filePath) => filePath.endsWith(".json"))).toEqual(
      []
    );
  });

  it("retries a temporary-name collision without deleting the colliding file", async () => {
    const { fs: baseFs, volume } = createServices();
    let attempts = 0;
    let collidingPath: string | undefined;
    const fs = {
      ...baseFs,
      writeFile: vi.fn(async (...args: Parameters<typeof baseFs.writeFile>) => {
        attempts += 1;
        if (attempts === 1) {
          collidingPath = String(args[0]);
          await baseFs.writeFile(collidingPath, "collision", { flag: "wx" });
          throw Object.assign(new Error("collision"), { code: "EEXIST" });
        }
        await baseFs.writeFile(...args);
      })
    };
    const source = await loadCachedOpenApiSource(SOURCE_URL, {
      cache: { directory: "/cache" },
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(SPEC_TEXT)),
      fs,
      timeoutMs: 100
    });

    await source.commit?.();

    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(
      Object.keys(volume.toJSON()).filter((filePath) => filePath.endsWith(".json"))
    ).toHaveLength(1);
    expect(collidingPath).toBeDefined();
    expect(await baseFs.readFile(collidingPath ?? "", "utf8")).toBe("collision");
  });

  it("ignores asynchronous reporting-hook failures", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          })
      );
    const options = {
      cache: {
        directory: "/cache",
        maxAgeMs: 0,
        onFallback: async () => {
          throw new Error("fallback reporter failed");
        }
      },
      fetch,
      fs,
      onTimeout: async () => {
        throw new Error("timeout reporter failed");
      },
      timeoutMs: 5
    };
    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).resolves.toMatchObject({
      sourceText: SPEC_TEXT
    });
    await Promise.resolve();
  });

  it("keeps a no-store live document usable when cache removal fails", async () => {
    const { fs: baseFs } = createServices();
    const fs = {
      ...baseFs,
      unlink: vi.fn(async () => {
        throw Object.assign(new Error("disk failure"), { code: "EIO" });
      })
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockResolvedValueOnce(new Response(SPEC_TEXT, { headers: { "cache-control": "no-store" } }));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };
    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);
    const second = await loadCachedOpenApiSource(SOURCE_URL, options);

    await expect(second.commit?.()).resolves.toBeUndefined();
    expect(second.sourceText).toBe(SPEC_TEXT);
  });

  it("does not hide non-success HTTP responses behind the cache", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockResolvedValueOnce(
        new Response("unavailable", {
          status: 503,
          statusText: "Service Unavailable"
        })
      );
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    const first = await loadCachedOpenApiSource(SOURCE_URL, options);
    await commitSource(first);

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).rejects.toThrow(
      'Failed to fetch "https://example.com/openapi.json": 503 Service Unavailable'
    );
  });

  it("does not expose an uncommitted response as an offline fallback", async () => {
    const { fs } = createServices();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(SPEC_TEXT))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    await loadCachedOpenApiSource(SOURCE_URL, options);

    await expect(loadCachedOpenApiSource(SOURCE_URL, options)).rejects.toThrow(
      "Network request failed"
    );
  });
});
