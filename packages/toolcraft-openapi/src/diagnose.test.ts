import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnose.js";
import type { OpenApiDocument } from "./generate.js";
import type { ToolcraftConfig } from "./config.js";

function createDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Example", version: "1.0.0" },
    paths: {
      "/messages": {
        get: {
          operationId: "listMessages",
          responses: { "200": { description: "ok" } }
        },
        post: {
          operationId: "createMessage",
          responses: { "200": { description: "ok" } }
        }
      },
      "/internal/health": {
        get: {
          operationId: "health",
          responses: { "200": { description: "ok" } }
        }
      }
    }
  };
}

describe("diagnose", () => {
  it("reports unmapped endpoints when resources omit operations not listed as unspecified", () => {
    const config: ToolcraftConfig = {
      edition: "2026-05-16",
      resources: {
        messages: {
          methods: {
            list: { method: "get", path: "/messages" }
          }
        }
      },
      unspecified_endpoints: ["get /internal/health"]
    };

    expect(diagnose(config, createDocument())).toEqual([
      expect.objectContaining({
        code: "TOOLCRAFT_OPENAPI_001",
        location: "paths./messages.post"
      })
    ]);
  });

  it("reports duplicate configured method bindings", () => {
    const config: ToolcraftConfig = {
      edition: "2026-05-16",
      resources: {
        messages: {
          methods: {
            list: { method: "get", path: "/messages" },
            all: { method: "get", path: "/messages" }
          }
        }
      }
    };

    expect(diagnose(config, createDocument())).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        code: "TOOLCRAFT_OPENAPI_002"
      })
      ])
    );
  });

  it("reports unknown pagination schemes", () => {
    const config: ToolcraftConfig = {
      edition: "2026-05-16",
      resources: {
        messages: {
          methods: {
            list: { method: "get", path: "/messages", pagination: "cursor" }
          }
        }
      }
    };

    expect(diagnose(config, createDocument())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TOOLCRAFT_OPENAPI_003",
          location: "resources.messages.methods.list"
        })
      ])
    );
  });
});
