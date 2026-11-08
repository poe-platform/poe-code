import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate, compileJsonSchema } from "toolcraft-schema";
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
  it.each([
    { source: { type: "string", minLength: 2, maxLength: 4 }, accepted: "okay", rejected: ["a", "longer"] },
    { source: { type: "number", minimum: 2, maximum: 4 }, accepted: 3, rejected: [1, 5] },
    { source: { type: "integer", minimum: 2, maximum: 4 }, accepted: 3, rejected: [1, 5, 3.5] },
    { source: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 }, accepted: ["a"], rejected: [[], ["a", "b", "c"]] }
  ])("preserves upstream size and range constraints $source", ({ source, accepted, rejected }) => {
    const converted = convertJsonSchema(source as JsonSchema);
    const wire = compileJsonSchema(toJsonSchema(converted));
    expect(validate(converted, accepted).ok).toBe(true);
    expect(wire.validate(accepted).ok).toBe(true);
    for (const value of rejected) {
      expect(validate(converted, value).ok).toBe(false);
      expect(wire.validate(value).ok).toBe(false);
    }
  });
  it.each([{ type: "null" as const }, { const: null }, { enum: [null] }])("preserves a null-only schema %j", (source) => {
    const converted = convertJsonSchema(source);
    const validator = compileJsonSchema(toJsonSchema(converted));
    expect(validate(converted, null).ok).toBe(true);
    expect(validator.validate(null).ok).toBe(true);
    for (const value of [false, 0, "null", [], {}]) {
      expect(validate(converted, value).ok).toBe(false);
      expect(validator.validate(value).ok).toBe(false);
    }
  });
  it.each([
    { source: { const: { status: "ready", nested: [1, true] } }, accepted: { nested: [1, true], status: "ready" }, rejected: { status: "wrong", nested: [1, true] } },
    { source: { const: [1, { ok: true }] }, accepted: [1, { ok: true }], rejected: [1, { ok: false }] },
    { source: { enum: [{ status: "ready" }, [1, 2], null] }, accepted: [1, 2], rejected: [2, 1] }
  ])("preserves JSON literal constraints $source", ({ source, accepted, rejected }) => {
    const converted = convertJsonSchema(source);
    expect(validate(converted, accepted).ok).toBe(true);
    expect(validate(converted, rejected).ok).toBe(false);
    const validator = compileJsonSchema(toJsonSchema(converted));
    expect(validator.validate(accepted).ok).toBe(true);
    expect(validator.validate(rejected).ok).toBe(false);
  });
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

    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(validate(S.Optional(converted), undefined)).toMatchObject({ ok: true, value: { name: "demo" } });
    expect(converted).toMatchObject(
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

  it("projects discriminated anyOf branches while preserving native semantics", async () => {
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

    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(converted).toMatchObject(
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

  it("projects undiscriminated branches while preserving native semantics", async () => {
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

    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(converted).toMatchObject(
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

  it("preserves object maps with an object projection usable as MCP input", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {},
      additionalProperties: {
        type: "boolean"
      }
    });

    const converted = convertJsonSchema(schema);
    expect(converted.kind).toBe("object");
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(validate(converted, { dynamic: true }).ok).toBe(true);
    expect(validate(converted, { dynamic: 1 }).ok).toBe(false);
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
    const converted = convertJsonSchema(jsonSchemaNullable);
    expect(converted).toMatchObject(
      S.String({
        nullable: true
      })
    );
    expect(validate(converted, null).ok).toBe(true);
    expect(validate(converted, "value").ok).toBe(true);
    expect(validate(converted, 1).ok).toBe(false);
    expect(toJsonSchema(converted)).toEqual(jsonSchemaNullable);
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

    const converted = convertJsonSchema(schema);
    expect(converted).toMatchObject(
      S.Enum(["assistant"] as const, {
        default: "assistant"
      })
    );
    expect(validate(converted, "assistant").ok).toBe(true);
    expect(validate(converted, "different").ok).toBe(false);
    expect(toJsonSchema(converted)).toEqual(schema);
  });

  it("retains an object projection and validates recursive references", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        child: {
          $ref: "#"
        }
      }
    });

    const converted = convertJsonSchema(schema);
    expect(converted.kind).toBe("object");
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(validate(converted, { child: { child: {} } }).ok).toBe(true);
    expect(validate(converted, { child: 2 }).ok).toBe(false);
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

    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(converted).toMatchObject(
      S.Object({
        value: S.String()
      })
    );
  });

  it("retains valid multiple types with native validation", async () => {
    const schema = await loadSchema({
      type: ["string", "number"]
    });

    const compiler = compileJsonSchema(schema);
    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    for (const value of ["value", 1, null, true, {}]) expect(validate(converted, value).ok).toBe(compiler.validate(value).ok);
  });

  it("accepts arrays without an items constraint", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        tags: {
          type: "array"
        }
      }
    });

    expect(compileJsonSchema(schema).validate({ tags: [1, "yes", null] }).ok).toBe(true);
    const converted = convertJsonSchema(schema);
    expect(validate(converted, { tags: [1, "yes", null] }).ok).toBe(true);
    expect(validate(converted, { tags: "wrong" }).ok).toBe(false);
    expect(toJsonSchema(converted)).toEqual(schema);
  });

  it("accepts unconstrained JSON properties", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        payload: {}
      }
    });

    const converted = convertJsonSchema(schema);
    for (const payload of [null, false, 1, "yes", [1], { a: true }]) {
      expect(compileJsonSchema(schema).validate({ payload }).ok).toBe(true);
      expect(validate(converted, { payload }).ok).toBe(true);
    }
    expect(toJsonSchema(converted)).toEqual(schema);
  });

  it("retains scalar composition branches with native validation", async () => {
    const schema = await loadSchema({
      oneOf: [
        {
          type: "string"
        }
      ]
    });

    const converted = convertJsonSchema(schema);
    expect(toJsonSchema(converted)).toEqual(schema);
    expect(validate(converted, "value").ok).toBe(true);
    expect(validate(converted, 1).ok).toBe(false);
  });

  it("reports the schema path when composition has no branches", async () => {
    const schema = await loadSchema({
      anyOf: []
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'JSON Schema "#" uses oneOf/anyOf/allOf but has no branches.'
    );
  });

  it("rejects references unavailable to the native compiler", async () => {
    const schema = await loadSchema({
      type: "object",
      properties: {
        payload: {
          $ref: "https://example.com/schema.json"
        }
      }
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'Unresolvable $ref: https://example.com/schema.json'
    );
  });

  it("does not resolve missing refs through inherited prototype properties", async () => {
    const schema = await loadSchema({
      $ref: "#/__proto__"
    });

    expect(() => convertJsonSchema(schema)).toThrow(
      'Unresolvable $ref: #/__proto__'
    );
  });
});
