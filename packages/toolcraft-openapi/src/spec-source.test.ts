import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseOpenApiDocument, readOpenApiSourceText } from "./spec-source.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(Object.prototype, key, descriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    }
  }
}

describe("readOpenApiSourceText", () => {
  it("includes status, status text, content-type, and an HTML snippet for 404 responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("<!doctype html>\n<title>Not Found</title>\n<h1>Missing spec</h1>", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    );

    await expect(
      readOpenApiSourceText("https://example.com/openapi.json", {
        cwd: "/repo",
        fetch,
        fs: createFsFromVolume(Volume.fromJSON({})).promises
      })
    ).rejects.toThrowError(
      /Failed to fetch "https:\/\/example\.com\/openapi\.json": 404 Not Found \(content-type: text\/html; charset=utf-8\)\n {2}body: <!doctype html> <title>Not Found<\/title> <h1>Missing spec<\/h1>/
    );
  });

  it("includes content-type and a JSON problem snippet for 500 responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://example.com/problems/internal-error",
          title: "Internal error"
        }),
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "application/problem+json" }
        }
      )
    );

    await expect(
      readOpenApiSourceText("https://example.com/openapi.json", {
        cwd: "/repo",
        fetch,
        fs: createFsFromVolume(Volume.fromJSON({})).promises
      })
    ).rejects.toThrowError(
      /Failed to fetch "https:\/\/example\.com\/openapi\.json": 500 Internal Server Error \(content-type: application\/problem\+json\)\n {2}body: \{"type":"https:\/\/example\.com\/problems\/internal-error","title":"Internal error"\}/
    );
  });

  it("caps non-2xx response body snippets after collapsing them to one line", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(`${"x".repeat(250)}\n\t${"y".repeat(600)}`, {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/plain" }
      })
    );

    await expect(
      readOpenApiSourceText("https://example.com/openapi.json", {
        cwd: "/repo",
        fetch,
        fs: createFsFromVolume(Volume.fromJSON({})).promises
      })
    ).rejects.toThrowError(new RegExp(`body: ${"x".repeat(250)} ${"y".repeat(249)}…$`));
  });

  it("classifies spec fetch network failures before generic read handling", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(
      new TypeError("fetch failed", {
        cause: { code: "ENOTFOUND", address: "api.example.test" }
      })
    );

    await expect(
      readOpenApiSourceText("https://api.example.test/openapi.json", {
        cwd: "/repo",
        fetch,
        fs: createFsFromVolume(Volume.fromJSON({})).promises
      })
    ).rejects.toThrowError(
      "DNS lookup failed for api.example.test. Check the URL or your network."
    );
  });

  it("mentions the absolute resolved filesystem path for ENOENT errors", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({})).promises;

    await expect(
      readOpenApiSourceText("openapi.json", {
        cwd: "/repo",
        fetch: vi.fn<typeof globalThis.fetch>(),
        fs
      })
    ).rejects.toThrowError(
      /Failed to read OpenAPI document "openapi\.json": .*\/repo\/openapi\.json/
    );
  });
});

describe("parseOpenApiDocument", () => {
  it("uses the native JSON parser for JSON OpenAPI documents", () => {
    const source = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Bots", version: "1.0.0" },
      paths: {}
    });
    const parseJson = vi.spyOn(JSON, "parse");

    expect(parseOpenApiDocument(source, "openapi.json")).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Bots" }
    });
    expect(parseJson).toHaveBeenCalledWith(source);

    parseJson.mockRestore();
  });

  it("includes YAML parse positions from linePos when available", () => {
    expect(() =>
      parseOpenApiDocument("openapi: 3.0.3\ninfo:\n  title: Test\n    bad: nope\n", "openapi.yaml")
    ).toThrowError(
      /Failed to parse OpenAPI document "openapi\.yaml": [\s\S]*\(at line 3 column 10\)/
    );
  });

  it("ignores inherited YAML parse positions", async () => {
    vi.resetModules();
    vi.doMock("yaml", () => ({
      parse: () => {
        throw {};
      }
    }));

    try {
      const { parseOpenApiDocument: parseWithMockedYaml } = await import("./spec-source.js");

      await withObjectPrototypeProperties(
        {
          line: 99,
          linePos: [{ line: 99, col: 88 }],
          col: 88,
          pos: [5]
        },
        async () => {
          expect(() => parseWithMockedYaml("openapi: [", "openapi.yaml")).toThrowError(
            'Failed to parse OpenAPI document "openapi.yaml": [object Object]'
          );
        }
      );
    } finally {
      vi.doUnmock("yaml");
      vi.resetModules();
    }
  });
});
