import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  mergeToolcraftConfig,
  readToolcraftConfig,
  validateToolcraftConfig
} from "./config.js";

describe("toolcraft.yml config", () => {
  it("parses YAML config and applies defaults", async () => {
    const volume = Volume.fromJSON({
      "/repo/toolcraft.yml": [
        "edition: 2026-05-16",
        "environments:",
        "  production: https://api.example.com/v1",
        "client_settings:",
        "  idempotency_header: Idempotency-Key",
        "pagination:",
        "  cursor:",
        "    request: { cursor: cursor, limit: limit }",
        "    response: { items: data, next_cursor: meta.next_cursor }",
        "resources:",
        "  messages:",
        "    methods:",
        "      list: get /messages { pagination: cursor }",
        "unspecified_endpoints:",
        "  - post /internal/replay"
      ].join("\n")
    });
    const fs = createFsFromVolume(volume).promises;

    const result = await readToolcraftConfig("/repo/toolcraft.yml", { fs });

    expect(result.diagnostics).toEqual([]);
    expect(result.config).toMatchObject({
      edition: "2026-05-16",
      environments: {
        production: "https://api.example.com/v1"
      },
      client_settings: {
        idempotency_header: "Idempotency-Key"
      },
      pagination: {
        cursor: {
          request: { cursor: "cursor", limit: "limit" },
          response: { items: "data", next_cursor: "meta.next_cursor" }
        }
      },
      resources: {
        messages: {
          methods: {
            list: {
              method: "get",
              path: "/messages",
              pagination: "cursor"
            }
          }
        }
      },
      unspecified_endpoints: ["post /internal/replay"]
    });
  });

  it("does not rewrite unrelated scalar values while recovering method shorthand", async () => {
    const volume = Volume.fromJSON({
      "/repo/toolcraft.yml": [
        "edition: 2026-05-16",
        "readme:",
        "  examples:",
        "    messages.create:",
        "      - title: 'Example with braces { untouched }'",
        "        params: { body: hello }",
        "resources:",
        "  messages:",
        "    methods:",
        "      create: post /messages { idempotent: true }"
      ].join("\n")
    });
    const fs = createFsFromVolume(volume).promises;

    const result = await readToolcraftConfig("/repo/toolcraft.yml", { fs });

    expect(result.diagnostics).toEqual([]);
    expect(result.config?.readme?.examples?.["messages.create"]?.[0]?.title).toBe(
      "Example with braces { untouched }"
    );
    expect(result.config?.resources?.messages?.methods?.create).toMatchObject({
      method: "post",
      path: "/messages",
      idempotent: true
    });
  });

  it("reports validation diagnostics instead of throwing", () => {
    const result = validateToolcraftConfig({
      edition: "2025-01-01",
      retries: { max: "three" }
    });

    expect(result.config).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "TOOLCRAFT_OPENAPI_006",
      "TOOLCRAFT_OPENAPI_007"
    ]);
  });

  it("deep merges config overrides without losing nested values", () => {
    expect(
      mergeToolcraftConfig(
        {
          edition: "2026-05-16",
          environments: {
            production: "https://api.example.com",
            sandbox: "https://sandbox.example.com"
          },
          retries: {
            max: 2,
            retry_on: [429]
          }
        },
        {
          environments: {
            sandbox: "https://sandbox-v2.example.com"
          },
          retries: {
            backoff: "exponential"
          }
        }
      )
    ).toEqual({
      edition: "2026-05-16",
      environments: {
        production: "https://api.example.com",
        sandbox: "https://sandbox-v2.example.com"
      },
      retries: {
        max: 2,
        backoff: "exponential",
        retry_on: [429]
      }
    });
  });
});
