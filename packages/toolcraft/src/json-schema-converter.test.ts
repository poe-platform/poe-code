import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { convertJsonSchema } from "./json-schema-converter.js";
import type { JsonSchema } from "./json-schema-converter.js";

async function loadSchema(schema: JsonSchema): Promise<JsonSchema> {
  const volume = Volume.fromJSON(
    {
      "/schema.json": JSON.stringify(schema)
    },
    "/"
  );
  const fs = createFsFromVolume(volume).promises;
  const raw = await fs.readFile("/schema.json", "utf8");

  return JSON.parse(raw) as JsonSchema;
}

describe("convertJsonSchema", () => {
  it("converts object properties into an object schema and preserves required keys", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" }
      },
      required: ["name"],
      additionalProperties: false
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Object(
        {
          name: S.String(),
          nickname: S.Optional(S.String())
        },
        {
          additionalProperties: false
        }
      )
    );
  });

  it("preserves object defaults from JSON Schema metadata", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        name: { type: "string" }
      },
      required: ["name"],
      default: {
        name: "demo"
      }
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Object(
        {
          name: S.String()
        },
        {
          default: {
            name: "demo"
          }
        }
      )
    );
  });

  it("preserves object schema properties named __proto__", async () => {
    const schema = await loadSchema(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"additionalProperties":false}'
      ) as JsonSchema
    );
    const converted = convertJsonSchema(schema);

    expect(converted.kind).toBe("object");
    if (converted.kind !== "object") {
      throw new Error("Expected object schema.");
    }

    expect(Object.hasOwn(converted.shape, "__proto__")).toBe(true);
    expect(converted.shape["__proto__"]).toEqual(S.String());
    expect(converted.additionalProperties).toBe(false);
  });

  it("converts strings and carries pattern metadata", async () => {
    const schema = await loadSchema({
      type: "string",
      pattern: "^[a-z]+$"
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.String({
        pattern: "^[a-z]+$"
      })
    );
  });

  it("converts number and integer schemas into number schemas", async () => {
    const numberSchema = await loadSchema({
      type: "number"
    });
    const integerSchema = await loadSchema({
      type: "integer"
    });

    expect(convertJsonSchema(numberSchema)).toEqual(S.Number());
    expect(convertJsonSchema(integerSchema)).toEqual(
      S.Number({
        jsonType: "integer"
      })
    );
  });

  it("converts booleans into boolean schemas", async () => {
    const schema = await loadSchema({
      type: "boolean"
    });

    expect(convertJsonSchema(schema)).toEqual(S.Boolean());
  });

  it("converts arrays by converting their item schema", async () => {
    const schema = await loadSchema({
      type: "array",
      items: {
        type: "string"
      }
    });

    expect(convertJsonSchema(schema)).toEqual(S.Array(S.String()));
  });

  it("converts primitive enums into enum schemas", async () => {
    const schema = await loadSchema({
      enum: ["safe", "fast"]
    });

    expect(convertJsonSchema(schema)).toEqual(S.Enum(["safe", "fast"] as const));
  });

  it("converts object enums into json schemas with descriptive metadata", async () => {
    const schema = await loadSchema({
      description: "Strategy payload",
      enum: [{ mode: "safe" }, { mode: "fast" }]
    });

    const converted = convertJsonSchema(schema);

    expect(converted.kind).toBe("json");
    expect(converted.description).toContain("Strategy payload");
    expect(converted.description).toContain('{"mode":"safe"}');
    expect(converted.description).toContain('{"mode":"fast"}');
  });

  it("converts discriminated anyOf object branches into oneOf schemas", async () => {
    const schema = await loadSchema({
      anyOf: [
        {
          type: "object",
          properties: {
            kind: {
              const: "text"
            },
            value: {
              type: "string"
            }
          },
          required: ["kind", "value"]
        },
        {
          type: "object",
          properties: {
            kind: {
              const: "count"
            },
            value: {
              type: "integer"
            }
          },
          required: ["kind", "value"]
        }
      ]
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.OneOf({
        discriminator: "kind",
        branches: {
          text: S.Object({
            value: S.String()
          }),
          count: S.Object({
            value: S.Number({
              jsonType: "integer"
            })
          })
        }
      })
    );
  });

  it("converts undiscriminated object branches into unions", async () => {
    const schema = await loadSchema({
      oneOf: [
        {
          type: "object",
          properties: {
            email: {
              type: "string"
            },
            name: {
              type: "string"
            }
          },
          required: ["email"]
        },
        {
          type: "object",
          properties: {
            phone: {
              type: "string"
            },
            extension: {
              type: "integer"
            }
          },
          required: ["phone"]
        }
      ]
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Union([
        S.Object({
          email: S.String(),
          name: S.Optional(S.String())
        }),
        S.Object({
          phone: S.String(),
          extension: S.Optional(
            S.Number({
              jsonType: "integer"
            })
          )
        })
      ])
    );
  });

  it("converts object maps into record schemas", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {},
      additionalProperties: {
        type: "boolean"
      }
    });

    expect(convertJsonSchema(schema)).toEqual(S.Record(S.Boolean()));
  });

  it("converts nullable schemas without turning null into a string", async () => {
    const openApiNullable = await loadSchema({
      type: "string",
      nullable: true
    });
    const jsonSchemaNullable = await loadSchema({
      type: ["string", "null"]
    });

    expect(convertJsonSchema(openApiNullable)).toEqual(
      S.String({
        nullable: true
      })
    );
    expect(convertJsonSchema(jsonSchemaNullable)).toEqual(
      S.String({
        nullable: true
      })
    );
  });

  it("converts primitive enums with null into nullable enum schemas", async () => {
    const schema = await loadSchema({
      enum: ["safe", "fast", null]
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Enum(["safe", "fast"] as const, {
        nullable: true
      })
    );
  });

  it("converts const values into fixed schemas with injected defaults", async () => {
    const schema = await loadSchema({
      const: "assistant",
      type: "string"
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Enum(["assistant"] as const, {
        default: "assistant"
      })
    );
  });

  it("falls back to json for recursive references", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        child: {
          $ref: "#"
        }
      }
    });

    expect(convertJsonSchema(schema)).toEqual(S.Json());
  });

  it("resolves non-recursive local refs before converting", async () => {
    const schema = await loadSchema({
      $defs: {
        payload: {
          type: "object",
          properties: {
            value: {
              type: "string"
            }
          },
          required: ["value"]
        }
      },
      $ref: "#/$defs/payload"
    });

    expect(convertJsonSchema(schema)).toEqual(
      S.Object({
        value: S.String()
      })
    );
  });

  it("throws for unsupported multi-type schemas that are not nullable wrappers", async () => {
    const schema = await loadSchema({
      type: ["string", "number"]
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#" has an unsupported type "["string","number"]". Supported: string, number, integer, boolean, array, object.'
    );
  });

  it("reports the schema path when an array is missing items", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        tags: {
          type: "array"
        }
      }
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#/properties/tags" is an array but is missing the "items" field. Add "items": { ... } to declare the element type.'
    );
  });

  it("reports the schema path when no schema keyword is declared", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        payload: {}
      }
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#/properties/payload" must declare one of: "type", "enum", "const", "oneOf", "anyOf", or "allOf".'
    );
  });

  it("reports the branch path when a composition branch is not an object schema", async () => {
    const schema = await loadSchema({
      oneOf: [
        {
          type: "string"
        }
      ]
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'Expected "#/oneOf/0" to be an object schema (got "string").'
    );
  });

  it("reports the schema path when composition has no branches", async () => {
    const schema = await loadSchema({
      anyOf: []
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#" uses oneOf/anyOf/allOf but has no branches.'
    );
  });

  it("reports the schema path and ref value for unsupported refs", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        payload: {
          $ref: "https://example.com/schema.json"
        }
      }
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#/properties/payload" uses "$ref": https://example.com/schema.json. toolcraft only supports internal refs like "#/components/schemas/Foo".'
    );
  });

  it("does not resolve missing refs through inherited prototype properties", async () => {
    const schema = await loadSchema({
      $ref: "#/__proto__"
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#" uses "$ref": #/__proto__. toolcraft only supports internal refs like "#/components/schemas/Foo".'
    );
  });
});
