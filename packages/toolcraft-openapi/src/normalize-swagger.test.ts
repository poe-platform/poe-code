import { describe, expect, it } from "vitest";
import { normalizeOpenApiDocument } from "./normalize-swagger.js";

describe("normalizeOpenApiDocument", () => {
  it("returns OpenAPI 3 documents unchanged", () => {
    const document = { openapi: "3.0.3", info: { title: "Bots", version: "1" }, paths: {} };

    expect(normalizeOpenApiDocument(document)).toBe(document);
  });

  it("normalizes Swagger 2 parameters, bodies, responses, refs, and security definitions", () => {
    const document = normalizeOpenApiDocument({
      swagger: "2.0",
      info: { title: "Bots", version: "1" },
      consumes: ["application/json"],
      produces: ["application/json", "text/csv"],
      securityDefinitions: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      definitions: {
        Bot: { type: "object", properties: { name: { type: "string" } } }
      },
      paths: {
        "/bots": {
          post: {
            operationId: "createBot",
            parameters: [
              { name: "limit", in: "query", type: "integer", default: 10 },
              {
                name: "body",
                in: "body",
                required: true,
                schema: { $ref: "#/definitions/Bot" }
              }
            ],
            responses: {
              "200": { description: "Created.", schema: { $ref: "#/definitions/Bot" } }
            }
          }
        }
      }
    } as never);

    expect(document).toMatchObject({
      openapi: "3.0.3",
      components: {
        schemas: { Bot: { type: "object" } },
        securitySchemes: { apiKey: { type: "apiKey" } }
      },
      paths: {
        "/bots": {
          post: {
            parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 10 } }],
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Bot" } }
              }
            },
            responses: {
              "200": {
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Bot" } },
                  "text/csv": { schema: { $ref: "#/components/schemas/Bot" } }
                }
              }
            }
          }
        }
      }
    });
  });

  it("resolves referenced Swagger 2 query and body parameters before normalization", () => {
    const document = normalizeOpenApiDocument({
      swagger: "2.0",
      info: { title: "Bots", version: "1" },
      parameters: {
        Limit: { name: "limit", in: "query", type: "integer" },
        Payload: {
          name: "payload",
          in: "body",
          required: true,
          schema: { type: "object", properties: { name: { type: "string" } } }
        }
      },
      paths: {
        "/bots": {
          post: {
            operationId: "createBot",
            parameters: [{ $ref: "#/parameters/Limit" }, { $ref: "#/parameters/Payload" }],
            responses: { "200": { description: "Created." } }
          }
        }
      }
    } as never);

    expect(document.paths?.["/bots"]?.post).toMatchObject({
      parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { name: { type: "string" } } }
          }
        }
      }
    });
  });

  it("normalizes Swagger 2 formData parameters into a URL-encoded request body", () => {
    const document = normalizeOpenApiDocument({
      swagger: "2.0",
      info: { title: "Bots", version: "1" },
      paths: {
        "/check": {
          post: {
            operationId: "check",
            parameters: [
              { name: "text", in: "formData", required: true, type: "string" },
              { name: "picky", in: "formData", type: "boolean" }
            ],
            responses: { "200": { description: "Checked." } }
          }
        }
      }
    } as never);

    expect(document.paths?.["/check"]?.post).toMatchObject({
      parameters: [],
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["text"],
              properties: {
                text: { type: "string" },
                picky: { type: "boolean" }
              }
            }
          }
        }
      }
    });
  });

  it("normalizes Swagger 2 file formData parameters into multipart binary fields", () => {
    const document = normalizeOpenApiDocument({
      swagger: "2.0",
      info: { title: "Bots", version: "1" },
      paths: {
        "/uploads": {
          post: {
            operationId: "upload",
            consumes: ["multipart/form-data"],
            parameters: [
              { name: "config", in: "formData", required: true, type: "file" },
              { name: "label", in: "formData", type: "string" }
            ],
            responses: { "200": { description: "Uploaded." } }
          }
        }
      }
    } as never);

    expect(document.paths?.["/uploads"]?.post).toMatchObject({
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: {
              properties: {
                config: { type: "string", format: "binary" },
                label: { type: "string" }
              }
            }
          }
        }
      }
    });
  });
});
