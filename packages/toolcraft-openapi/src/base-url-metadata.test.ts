import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { UserError } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { defineClientFromSpec, resolveOpenApiBaseUrl, type OpenApiDocument } from "./index.js";

const sourceUrl = "https://specs.example.test/docs/openapi.json";
const auth = { getToken: async () => "fixture", commands: [] };

const invalidMetadata = [
  { name: "null servers", metadata: { servers: null }, message: "OpenAPI servers must be an array." },
  { name: "object servers", metadata: { servers: {} }, message: "OpenAPI servers must be an array." },
  { name: "string servers", metadata: { servers: "https://api.example.test" }, message: "OpenAPI servers must be an array." },
  { name: "number servers", metadata: { servers: 42 }, message: "OpenAPI servers must be an array." },
  { name: "boolean servers", metadata: { servers: false }, message: "OpenAPI servers must be an array." },
  { name: "null server", metadata: { servers: [null] }, message: "OpenAPI servers[0] must be an object." },
  { name: "array server", metadata: { servers: [[]] }, message: "OpenAPI servers[0] must be an object." },
  { name: "string server", metadata: { servers: ["https://api.example.test"] }, message: "OpenAPI servers[0] must be an object." },
  { name: "number server", metadata: { servers: [42] }, message: "OpenAPI servers[0] must be an object." },
  { name: "boolean server", metadata: { servers: [false] }, message: "OpenAPI servers[0] must be an object." },
  { name: "missing URL", metadata: { servers: [{}] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "null URL", metadata: { servers: [{ url: null }] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "number URL", metadata: { servers: [{ url: 42 }] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "boolean URL", metadata: { servers: [{ url: false }] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "object URL", metadata: { servers: [{ url: {} }] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "empty array URL", metadata: { servers: [{ url: [] }] }, message: "OpenAPI servers[0].url must be a string." },
  { name: "nonempty array URL", metadata: { servers: [{ url: ["/v1"] }] }, message: "OpenAPI servers[0].url must be a string." },
  ...[null, 42, false, {}, []].map((host) => ({
    name: `Swagger host ${JSON.stringify(host)}`,
    metadata: { swagger: "2.0", host },
    message: "OpenAPI Swagger host must be a string."
  })),
  ...[null, "https", 42, false, {}].map((schemes) => ({
    name: `Swagger schemes ${JSON.stringify(schemes)}`,
    metadata: { swagger: "2.0", schemes },
    message: "OpenAPI Swagger schemes must be an array."
  })),
  ...[null, 42, false, {}, []].map((scheme) => ({
    name: `Swagger scheme ${JSON.stringify(scheme)}`,
    metadata: { swagger: "2.0", schemes: [scheme] },
    message: "OpenAPI Swagger schemes[0] must be a string."
  })),
  ...[null, 42, false, {}, []].map((basePath) => ({
    name: `Swagger basePath ${JSON.stringify(basePath)}`,
    metadata: { swagger: "2.0", basePath },
    message: "OpenAPI Swagger basePath must be a string starting with '/'."
  })),
  ...["", "v1", "?version=1", "#v1"].map((basePath) => ({
    name: `Swagger basePath ${JSON.stringify(basePath)}`,
    metadata: { swagger: "2.0", basePath },
    message: "OpenAPI Swagger basePath must be a string starting with '/'."
  }))
];

function documentFor(metadata: Record<string, unknown>): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Metadata fixture", version: "1" },
    ...metadata,
    paths: { "/items": { get: { operationId: "listItems", responses: { "200": { description: "OK" } } } } }
  } as OpenApiDocument;
}

describe("root base URL metadata diagnostics", () => {
  it.each(invalidMetadata)("identifies $name in the public resolver", ({ metadata, message }) => {
    const document = documentFor(metadata);
    const original = structuredClone(document);
    for (const origin of [undefined, sourceUrl]) {
      expect(() => resolveOpenApiBaseUrl({ document, sourceUrl: origin })).toThrow(UserError);
      expect(() => resolveOpenApiBaseUrl({ document, sourceUrl: origin })).toThrow(message);
    }
    expect(document).toEqual(original);
  });

  describe.each(["document", "remote", "file"] as const)("%s source", (sourceKind) => {
    it.each(invalidMetadata)("rejects $name before client construction", async ({ metadata, message }) => {
      const document = documentFor(metadata);
      const original = structuredClone(document);
      const sourceText = JSON.stringify(document);
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(sourceText));
      const fs = createFsFromVolume(Volume.fromJSON({ "/fixture.json": sourceText })).promises;
      const source = sourceKind === "document" ? document : sourceKind === "remote" ? sourceUrl : "/fixture.json";
      await expect(defineClientFromSpec(source, { name: "fixture", auth, fetch, fs, cache: false }))
        .rejects.toThrow(new UserError(message));
      expect(fetch).toHaveBeenCalledTimes(sourceKind === "remote" ? 1 : 0);
      expect(await fs.readFile("/fixture.json", "utf8")).toBe(sourceText);
      expect(document).toEqual(original);
    });
  });

  it.each(invalidMetadata)("preserves explicit/environment precedence over $name", async ({ metadata }) => {
    const document = documentFor(metadata);
    const configured = "https://configured.example.test/v2";
    const explicit = "https://explicit.example.test/v3";
    expect(resolveOpenApiBaseUrl({ document, environments: { production: configured } })).toBe(configured);
    for (const baseUrl of [undefined, explicit]) {
      const client = await defineClientFromSpec(document, {
        name: "fixture", auth, baseUrl, config: { environments: { production: configured } }
      });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
      const sdk = createSDK(client.root, { services: client.services, fetch, approvals: false }) as { items: { list(): Promise<unknown> } };
      await sdk.items.list();
      expect(fetch).toHaveBeenCalledOnce();
      const [input, init] = fetch.mock.calls[0]!;
      expect(new Request(input, init).url).toBe(`${baseUrl ?? configured}/items`);
    }
  });

  it.each([
    { name: "absent servers", metadata: {}, expected: "https://specs.example.test" },
    { name: "empty servers", metadata: { servers: [] }, expected: "https://specs.example.test" },
    { name: "empty relative URL", metadata: { servers: [{ url: "" }] }, expected: "https://specs.example.test/docs/openapi.json" },
    { name: "relative server", metadata: { servers: [{ url: "/v1" }] }, expected: "https://specs.example.test/v1" },
    { name: "unused server", metadata: { servers: [{ url: "/v1" }, null] }, expected: "https://specs.example.test/v1" },
    { name: "Swagger defaults", metadata: { swagger: "2.0" }, expected: "https://specs.example.test" },
    { name: "Swagger empty schemes", metadata: { swagger: "2.0", schemes: [] }, expected: "https://specs.example.test" },
    { name: "Swagger host and port", metadata: { swagger: "2.0", host: "api.example.test:8443", schemes: ["https"], basePath: "/v1/" }, expected: "https://api.example.test:8443/v1" },
    { name: "unused Swagger scheme", metadata: { swagger: "2.0", schemes: ["https", null] }, expected: "https://specs.example.test" },
    { name: "irrelevant Swagger fields", metadata: { host: 42, schemes: null, basePath: false }, expected: "https://specs.example.test" },
    { name: "irrelevant OpenAPI servers", metadata: { swagger: "2.0", servers: null }, expected: "https://specs.example.test" }
  ])("retains consumed-field-only inference for $name", async ({ metadata, expected }) => {
    const document = documentFor(metadata);
    expect(resolveOpenApiBaseUrl({ document, sourceUrl })).toBe(expected);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(document)));
    const client = await defineClientFromSpec(sourceUrl, { name: "fixture", auth, fetch, cache: false });
    expect(client.services.baseUrl).toBe(expected);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
