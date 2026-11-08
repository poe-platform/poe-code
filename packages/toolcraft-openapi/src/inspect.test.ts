import { describe, expect, it } from "vitest";
import { inspectOpenApiDocument, type OpenApiDocument } from "./inspect.js";

function createDocument(paths: OpenApiDocument["paths"]): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Northstar API", version: "1.0.0" },
    paths
  };
}

describe("inspectOpenApiDocument", () => {
  it("reports operations that use nested JSON body fields as supported", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/widgets": {
          get: {
            tags: ["widgets"],
            operationId: "listWidgets",
            summary: "List widgets.",
            responses: { "200": { description: "Listed." } }
          },
          post: {
            tags: ["widgets"],
            operationId: "createWidget",
            summary: "Create a widget.",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { owner: { type: "object" } }
                  }
                }
              }
            },
            responses: { "201": { description: "Created." } }
          }
        }
      })
    );

    expect(report).toMatchObject({
      title: "Northstar API",
      version: "1.0.0",
      operationCount: 2,
      supportedCount: 2,
      unsupportedCount: 0
    });
    expect(report.operations).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/widgets",
        operationId: "listWidgets",
        status: "supported",
        commandPath: "widgets list"
      }),
      expect.objectContaining({
        method: "POST",
        path: "/widgets",
        operationId: "createWidget",
        status: "supported",
        commandPath: "widgets create-widget"
      })
    ]);
  });

  it("uses operation IDs to disambiguate generated command collisions", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/quotes": {
          get: {
            tags: ["forex"],
            operationId: "listQuotes",
            responses: { "200": { description: "Listed." } }
          }
        },
        "/symbols": {
          get: {
            tags: ["forex"],
            operationId: "listSymbols",
            responses: { "200": { description: "Listed." } }
          }
        }
      })
    );

    expect(report).toMatchObject({ operationCount: 2, supportedCount: 2, unsupportedCount: 0 });
    expect(report.operations).toEqual([
      expect.objectContaining({
        status: "supported",
        commandPath: "forex quotes"
      }),
      expect.objectContaining({
        status: "supported",
        commandPath: "forex symbols"
      })
    ]);
  });

  it("uses nested resource paths when operation IDs cannot disambiguate collisions", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/images/{imageDigest}": {
          get: {
            tags: ["images"],
            operationId: "get_image",
            parameters: [
              { name: "imageDigest", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: { "200": { description: "Viewed." } }
          }
        },
        "/images/{imageDigest}/content/{contentType}": {
          get: {
            tags: ["images"],
            operationId: "get_image",
            parameters: [
              { name: "imageDigest", in: "path", required: true, schema: { type: "string" } },
              { name: "contentType", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: { "200": { description: "Viewed." } }
          }
        }
      })
    );

    expect(report).toMatchObject({ operationCount: 2, supportedCount: 2, unsupportedCount: 0 });
    expect(report.operations).toEqual([
      expect.objectContaining({ status: "supported", commandPath: "images view-image-digest" }),
      expect.objectContaining({ status: "supported", commandPath: "images view-content" })
    ]);
  });

  it("uses parent path context when child resource paths collide", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/maps/{id}/attachments": {
          post: {
            tags: ["attachments"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "201": { description: "Created." } }
          }
        },
        "/spots/{id}/attachments": {
          post: {
            tags: ["attachments"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "201": { description: "Created." } }
          }
        }
      })
    );

    expect(report).toMatchObject({ operationCount: 2, supportedCount: 2, unsupportedCount: 0 });
    expect(report.operations).toEqual([
      expect.objectContaining({ commandPath: "attachments maps-id-attachments" }),
      expect.objectContaining({ commandPath: "attachments spots-id-attachments" })
    ]);
  });

  it("inspects each method independently when a path also declares an unsupported method", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/widgets/{id}": {
          get: {
            tags: ["widgets"],
            operationId: "viewWidget",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Viewed." } }
          },
          head: {
            tags: ["widgets"],
            operationId: "headWidget",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Checked." } }
          }
        } as never
      })
    );

    expect(report.operations).toEqual([
      expect.objectContaining({ method: "GET", status: "supported", commandPath: "widgets view" }),
      expect.objectContaining({ method: "HEAD", status: "supported", commandPath: "widgets check" })
    ]);
  });

  it("preserves cross-path references while inspecting an operation", () => {
    const report = inspectOpenApiDocument(
      createDocument({
        "/bots/{botId}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [{ name: "botId", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Viewed." } }
          }
        },
        "/bots/{botId}/status": {
          get: {
            tags: ["bots"],
            operationId: "viewBotStatus",
            parameters: [{ $ref: "#/paths/~1bots~1%7BbotId%7D/get/parameters/0" }],
            responses: { "200": { description: "Viewed." } }
          }
        }
      })
    );

    expect(report).toMatchObject({ operationCount: 2, supportedCount: 2, unsupportedCount: 0 });
  });
});
