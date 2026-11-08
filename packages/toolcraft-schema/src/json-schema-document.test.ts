import { describe, expect, it } from "vitest";
import { S, toJsonSchemaDocument } from "toolcraft-schema";

describe("toJsonSchemaDocument", () => {
  it("wraps a schema in a JSON Schema document with metadata", () => {
    const schema = S.Object({
      version: S.Number({ default: 1 }),
      core: S.Optional(
        S.Object({
          apiKey: S.String({ description: "Poe API key", default: "" })
        })
      )
    });

    expect(
      toJsonSchemaDocument(schema, {
        id: "https://example.test/poe-code.schema.json",
        title: "poe-code config",
        description: "Schema for poe-code config files"
      })
    ).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/poe-code.schema.json",
      title: "poe-code config",
      description: "Schema for poe-code config files",
      type: "object",
      additionalProperties: false,
      properties: {
        version: {
          type: "number",
          default: 1
        },
        core: {
          type: "object",
          additionalProperties: false,
          properties: {
            apiKey: {
              type: "string",
              description: "Poe API key",
              default: ""
            }
          },
          required: ["apiKey"]
        }
      },
      required: ["version"]
    });
  });
});
