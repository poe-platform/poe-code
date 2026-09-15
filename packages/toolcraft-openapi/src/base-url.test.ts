import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { UserError } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { defineClientFromSpec, resolveOpenApiBaseUrl, type OpenApiDocument } from "./index.js";

const sourceUrl = "https://specs.example.test:8443/docs/openapi.json";
const auth = { getToken: async () => "fixture", commands: [] };

interface BaseUrlScenario {
  name: string;
  metadata: Partial<OpenApiDocument>;
  expected: string;
  remoteOnly?: boolean;
}

const scenarios: BaseUrlScenario[] = [
  { name: "absolute server", metadata: { servers: [{ url: "https://api.example.test/v1/" }] }, expected: "https://api.example.test/v1" },
  { name: "repeated trailing separator", metadata: { servers: [{ url: "https://api.example.test/v1//" }] }, expected: "https://api.example.test/v1/" },
  { name: "path separator before query", metadata: { servers: [{ url: "https://api.example.test/v1/?label=one/" }] }, expected: "https://api.example.test/v1/?label=one/" },
  { name: "path separator before fragment", metadata: { servers: [{ url: "https://api.example.test/v1/#part/" }] }, expected: "https://api.example.test/v1/#part/" },
  { name: "path variable", metadata: { servers: [{ url: "https://api.example.test/{version}", variables: { version: { default: "v2" } } }] }, expected: "https://api.example.test/v2" },
  { name: "host variable", metadata: { servers: [{ url: "https://{region}.example.test/v1", variables: { region: { default: "east" } } }] }, expected: "https://east.example.test/v1" },
  { name: "port variable", metadata: { servers: [{ url: "https://api.example.test:{port}/v1", variables: { port: { default: "8443" } } }] }, expected: "https://api.example.test:8443/v1" },
  { name: "repeated variable", metadata: { servers: [{ url: "https://{name}.example.test/{name}", variables: { name: { default: "demo" } } }] }, expected: "https://demo.example.test/demo" },
  { name: "empty variable default", metadata: { servers: [{ url: "https://api.example.test/{path}", variables: { path: { default: "" } } }] }, expected: "https://api.example.test" },
  { name: "root relative", metadata: { servers: [{ url: "/v1" }] }, expected: "https://specs.example.test:8443/v1", remoteOnly: true },
  { name: "document relative", metadata: { servers: [{ url: "../v2" }] }, expected: "https://specs.example.test:8443/v2", remoteOnly: true },
  { name: "sibling relative", metadata: { servers: [{ url: "api" }] }, expected: "https://specs.example.test:8443/docs/api", remoteOnly: true },
  { name: "protocol relative", metadata: { servers: [{ url: "//api.example.test/v2" }] }, expected: "https://api.example.test/v2", remoteOnly: true },
  { name: "relative variable", metadata: { servers: [{ url: "/{version}", variables: { version: { default: "v3" } } }] }, expected: "https://specs.example.test:8443/v3", remoteOnly: true },
  { name: "missing servers", metadata: {}, expected: "https://specs.example.test:8443", remoteOnly: true },
  { name: "empty servers", metadata: { servers: [] }, expected: "https://specs.example.test:8443", remoteOnly: true },
  { name: "query ending in slash", metadata: { servers: [{ url: "https://api.example.test/v1?label=one/" }] }, expected: "https://api.example.test/v1?label=one/" },
  { name: "fragment ending in slash", metadata: { servers: [{ url: "https://api.example.test/v1#part/" }] }, expected: "https://api.example.test/v1#part/" },
  { name: "Swagger declared URL", metadata: { swagger: "2.0", host: "api.example.test:8080", schemes: ["http"], basePath: "/v1/" }, expected: "http://api.example.test:8080/v1" },
  { name: "Swagger default path", metadata: { swagger: "2.0", host: "api.example.test", schemes: ["https", "http"] }, expected: "https://api.example.test" },
  { name: "Swagger source host", metadata: { swagger: "2.0", schemes: ["http"], basePath: "/v1" }, expected: "http://specs.example.test:8443/v1", remoteOnly: true },
  { name: "Swagger source scheme", metadata: { swagger: "2.0", host: "api.example.test", basePath: "/v2" }, expected: "https://api.example.test/v2", remoteOnly: true },
  { name: "Swagger source defaults", metadata: { swagger: "2.0" }, expected: "https://specs.example.test:8443", remoteOnly: true }
];

function documentFor(metadata: Partial<OpenApiDocument>): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Base URL fixture", version: "1" },
    ...metadata,
    paths: {
      "/items": {
        get: {
          operationId: "listItems", tags: ["items"],
          responses: { "200": { description: "Items" } }
        }
      }
    }
  };
}

describe("root base URL inference", () => {
  it.each(scenarios)("resolves $name without mutating the document", ({ metadata, expected, remoteOnly }) => {
    const document = documentFor(metadata);
    const original = structuredClone(document);
    expect(resolveOpenApiBaseUrl({ document, ...(remoteOnly ? { sourceUrl } : {}) })).toBe(expected);
    expect(document).toEqual(original);
  });

  describe.each(["document", "URL string", "URL object"] as const)("%s source", (sourceKind) => {
    it.each(scenarios.filter((scenario) => sourceKind !== "document" || !scenario.remoteOnly))(
      "requests the resolved endpoint for $name",
      async ({ metadata, expected }) => {
        const document = documentFor(metadata);
        const original = structuredClone(document);
        const source = sourceKind === "document" ? document : sourceKind === "URL string" ? sourceUrl : new URL(sourceUrl);
        const sourceFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(document)));
        const client = await defineClientFromSpec(source, { name: "fixture", auth, fetch: sourceFetch, cache: false });
        expect(client.services.baseUrl).toBe(expected);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
        const sdk = createSDK(client.root, { services: client.services, fetch, approvals: false }) as { items: { list(): Promise<unknown> } };
        await sdk.items.list();
        const expectedUrl = new URL(expected);
        expectedUrl.pathname = `${expectedUrl.pathname.endsWith("/") ? expectedUrl.pathname.slice(0, -1) : expectedUrl.pathname}/items`;
        const [input, init] = fetch.mock.calls[0]!;
        expect(new Request(input, init).url).toBe(expectedUrl.toString());
        expect(fetch).toHaveBeenCalledOnce();
        expect(sourceFetch).toHaveBeenCalledTimes(sourceKind === "document" ? 0 : 1);
        expect(document).toEqual(original);
      }
    );
  });

  it.each(scenarios)("preserves explicit and configured overrides for $name", async ({ metadata }) => {
    const document = documentFor(metadata);
    const explicit = "https://explicit.example.test/v7?label=one/";
    const configured = "https://configured.example.test/v8?label=two/";
    expect(resolveOpenApiBaseUrl({ document, environments: { production: configured } })).toBe(configured);
    const client = await defineClientFromSpec(document, {
      name: "fixture", auth, baseUrl: explicit,
      config: { environments: { production: configured } }
    });
    expect(client.services.baseUrl).toBe(explicit);
  });

  it.each([
    { name: "missing variable", server: { url: "https://api.example.test/{version}" }, field: "servers[0].variables" },
    { name: "missing default", server: { url: "https://api.example.test/{version}", variables: { version: {} } }, field: "servers[0].variables" },
    { name: "non-string default", server: { url: "https://api.example.test/{version}", variables: { version: { default: 2 } } }, field: "servers[0].variables" },
    { name: "unterminated variable", server: { url: "https://api.example.test/{version" }, field: "servers[0].url" },
    { name: "relative without origin", server: { url: "/v1" }, field: "servers[0].url" },
    { name: "invalid absolute", server: { url: "https://api.example.test:invalid/v1" }, field: "servers[0].url" }
  ])("reports contextual errors for $name", async ({ server, field }) => {
    const document = documentFor({ servers: [server] } as Partial<OpenApiDocument>);
    expect(() => resolveOpenApiBaseUrl({ document })).toThrow(UserError);
    expect(() => resolveOpenApiBaseUrl({ document })).toThrow(field);
    await expect(defineClientFromSpec(document, { name: "fixture", auth, baseUrl: "https://override.example.test" })).resolves.toBeDefined();
  });

  it.each([{}, { servers: [] }, { swagger: "2.0" }, { swagger: "2.0", host: "api.example.test" }, { swagger: "2.0", schemes: ["https"] }])(
    "does not invent an origin for document input %j", (metadata) => {
      expect(resolveOpenApiBaseUrl({ document: documentFor(metadata) })).toBeUndefined();
    }
  );

  it("reports the selected environment for an invalid configured URL", () => {
    expect(() => resolveOpenApiBaseUrl({ document: documentFor({}), environments: { sandbox: "/v1" } })).toThrow('environments["sandbox"]');
  });

  it("keeps relative file inputs without an inferred network origin", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/fixture.json": JSON.stringify(documentFor({ servers: [{ url: "/v1" }] })) })).promises;
    await expect(defineClientFromSpec("/fixture.json", { name: "fixture", auth, fs })).rejects.toThrow("servers[0].url");
  });
});

afterEach(() => vi.restoreAllMocks());

describe("remote document location", () => {
  it.each(["no-store", "304 no-store", "304 redirect", "replacement"])(
    "uses the effective document location after %s", async (mode) => {
      const volume = new Volume();
      const fs = createFsFromVolume(volume).promises;
      const document = documentFor({ servers: [{ url: "./api" }] });
      const firstResponse = new Response(JSON.stringify(document), {
        headers: { etag: '"fixture"', ...(mode === "no-store" ? { "cache-control": "no-store" } : {}) }
      });
      Object.defineProperty(firstResponse, "url", { value: "https://first.example.test/docs/spec.json" });
      const secondResponse = mode === "replacement"
        ? new Response(JSON.stringify(document))
        : new Response(null, { status: 304, headers: mode === "304 no-store" ? { "cache-control": "no-store" } : {} });
      if (mode === "304 redirect" || mode === "replacement") {
        Object.defineProperty(secondResponse, "url", { value: "https://second.example.test/other/spec.json" });
      }
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);
      const options = { name: "fixture", auth, fetch, fs, cache: { directory: "/cache", maxAgeMs: 0 } };
      const first = await defineClientFromSpec(sourceUrl, options);
      expect(first.services.baseUrl).toBe("https://first.example.test/docs/api");
      if (mode !== "no-store") {
        const second = await defineClientFromSpec(sourceUrl, options);
        expect(second.services.baseUrl).toBe(mode === "304 no-store" ? first.services.baseUrl : "https://second.example.test/other/api");
      }
      if (mode === "no-store" || mode === "304 no-store") {
        expect(Object.values(volume.toJSON()).filter((contents) => contents !== null)).toHaveLength(0);
      }
    }
  );

  it.each([{ swagger: "2.0" }, {}])("uses the redirected origin for default servers %j", async (metadata) => {
    const response = new Response(JSON.stringify(documentFor(metadata)));
    Object.defineProperty(response, "url", { value: "http://redirect.example.test:8080/docs/spec.json" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const client = await defineClientFromSpec(sourceUrl, { name: "fixture", auth, fetch, cache: false });
    expect(client.services.baseUrl).toBe("http://redirect.example.test:8080");
  });

  it.each([false, { directory: "/cache", maxAgeMs: 60_000 }, { directory: "/cache", maxAgeMs: 0 }] as const)(
    "preserves redirected origins through cache mode %j", async (cache) => {
      const fs = createFsFromVolume(new Volume()).promises;
      const document = documentFor({ servers: [{ url: "./api" }] });
      const response = new Response(JSON.stringify(document), { headers: { etag: '"fixture"' } });
      Object.defineProperty(response, "url", { value: "https://redirect.example.test/definitions/spec.json" });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response).mockResolvedValue(new Response(null, { status: 304 }));
      const options = { name: "fixture", auth, fetch, fs, cache };
      const first = await defineClientFromSpec(sourceUrl, options);
      expect(first.services.baseUrl).toBe("https://redirect.example.test/definitions/api");
      if (cache === false) return;
      const second = await defineClientFromSpec(sourceUrl, options);
      expect(second.services.baseUrl).toBe(first.services.baseUrl);
      expect(fetch).toHaveBeenCalledTimes(cache.maxAgeMs === 0 ? 2 : 1);
      const cacheFile = (await fs.readdir("/cache"))[0]!;
      const entry = JSON.parse(await fs.readFile(`/cache/${cacheFile}`, "utf8"));
      entry.validatedAt = 0;
      await fs.writeFile(`/cache/${cacheFile}`, JSON.stringify(entry));
      fetch.mockRejectedValue(new TypeError("fetch failed"));
      const fallback = await defineClientFromSpec(sourceUrl, options);
      expect(fallback.services.baseUrl).toBe(first.services.baseUrl);
    }
  );

  it("refreshes legacy cache entries that lack a document location", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const document = documentFor({ servers: [{ url: "./api" }] });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      const response = new Response(JSON.stringify(document));
      Object.defineProperty(response, "url", { value: "https://redirect.example.test/spec.json" });
      return response;
    });
    const options = { name: "fixture", auth, fetch, fs, cache: { directory: "/cache" } };
    await defineClientFromSpec(sourceUrl, { ...options, baseUrl: "https://override.example.test" });
    const cachePath = Object.keys(volume.toJSON()).find((filePath) => filePath.endsWith(".json"))!;
    const entry = JSON.parse(await fs.readFile(cachePath, "utf8"));
    entry.version = 1;
    delete entry.sourceUrl;
    await fs.writeFile(cachePath, JSON.stringify(entry));
    const client = await defineClientFromSpec(sourceUrl, options);
    expect(client.services.baseUrl).toBe("https://redirect.example.test/api");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
