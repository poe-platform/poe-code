import { describe, expect, it, vi } from "vitest";
import { inspectOpenApiSource, type OpenApiDocument } from "./index.js";

const document: OpenApiDocument = {
  openapi: "3.0.3",
  info: { title: "Northstar API", version: "1.0.0" },
  paths: {
    "/widgets": {
      get: {
        tags: ["widgets"],
        operationId: "listWidgets",
        responses: { "200": { description: "Listed." } }
      }
    }
  }
};

describe("inspectOpenApiSource", () => {
  it("inspects a pre-parsed document", async () => {
    await expect(inspectOpenApiSource(document)).resolves.toMatchObject({
      operationCount: 1,
      supportedCount: 1
    });
  });

  it("inspects a URL source through the provided fetch", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(document), { headers: { "content-type": "application/json" } })
      );

    await expect(
      inspectOpenApiSource("https://example.com/openapi.json", { fetch })
    ).resolves.toMatchObject({ supportedCount: 1 });
    expect(fetch).toHaveBeenCalledWith("https://example.com/openapi.json");
  });
});
