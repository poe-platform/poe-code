import { describe, expect, expectTypeOf, it } from "vitest";
import { S, toJsonSchema, toJsonSchemaDocument, validate } from "toolcraft-schema";
import type {
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  JsonValueSchema,
  JsonSchema,
  NumberSchema,
  OneOfSchema,
  ObjectSchema,
  OptionalSchema,
  RecordSchema,
  Static,
  StringSchema,
  UnionSchema
} from "toolcraft-schema";

describe("toolcraft-schema", () => {
  it("exports typed builders from the package root", () => {
    const resolveMissing = async () => ({
      choices: [{ label: "Primary", value: "home-1" }]
    });
    const stringSchema = S.String({ description: "Name", default: "guest" });
    const numberSchema = S.Number({ description: "Count", default: 3 });
    const booleanSchema = S.Boolean({ description: "Enabled", default: false });
    const enumSchema = S.Enum(["admin", "user"] as const, {
      description: "Role",
      default: "admin"
    });
    const arraySchema = S.Array(S.String(), {
      description: "Tags",
      default: ["a", "b"]
    });
    const objectSchema = S.Object({
      name: S.String()
    });
    const optionalSchema = S.Optional(S.String());
    const oneOfSchema = S.OneOf({
      discriminator: "kind",
      branches: {
        text: S.Object({ value: S.String() }),
        count: S.Object({ value: S.Number() })
      }
    });
    const unionSchema = S.Union([S.Object({ email: S.String() }), S.Object({ phone: S.String() })]);
    const recordSchema = S.Record(S.String());
    const jsonSchema = S.Json();

    expect(stringSchema.kind).toBe("string");
    expect(numberSchema.kind).toBe("number");
    expect(booleanSchema.kind).toBe("boolean");
    expect(enumSchema.kind).toBe("enum");
    expect(arraySchema.kind).toBe("array");
    expect(objectSchema.kind).toBe("object");
    expect(optionalSchema.kind).toBe("optional");
    expect(oneOfSchema.kind).toBe("oneOf");
    expect(unionSchema.kind).toBe("union");
    expect(recordSchema.kind).toBe("record");
    expect(jsonSchema.kind).toBe("json");
    expect(S.String({ cli: { resolveMissing } }).cli?.resolveMissing).toBe(resolveMissing);

    expectTypeOf(stringSchema).toMatchTypeOf<StringSchema>();
    expectTypeOf(numberSchema).toMatchTypeOf<NumberSchema>();
    expectTypeOf(booleanSchema).toMatchTypeOf<BooleanSchema>();
    expectTypeOf(enumSchema).toMatchTypeOf<EnumSchema<readonly ["admin", "user"]>>();
    expectTypeOf(arraySchema).toMatchTypeOf<ArraySchema<StringSchema>>();
    expectTypeOf(objectSchema).toMatchTypeOf<ObjectSchema<{ name: StringSchema }>>();
    expectTypeOf(optionalSchema).toMatchTypeOf<OptionalSchema<StringSchema>>();
    expectTypeOf(oneOfSchema).toMatchTypeOf<
      OneOfSchema<
        {
          text: ObjectSchema<{ value: StringSchema }>;
          count: ObjectSchema<{ value: NumberSchema }>;
        },
        "kind"
      >
    >();
    expectTypeOf(unionSchema).toMatchTypeOf<
      UnionSchema<[ObjectSchema<{ email: StringSchema }>, ObjectSchema<{ phone: StringSchema }>]>
    >();
    expectTypeOf(recordSchema).toMatchTypeOf<RecordSchema<StringSchema>>();
    expectTypeOf(jsonSchema).toMatchTypeOf<JsonValueSchema>();
  });

  it("infers static types for nested objects, arrays, enums, and optional properties", () => {
    const ignoredSchema = S.Object({
      name: S.String(),
      count: S.Number({ default: 1 }),
      enabled: S.Boolean({ default: true }),
      role: S.Enum(["admin", "user"] as const),
      tags: S.Array(S.String()),
      metadata: S.Optional(
        S.Object({
          retries: S.Number(),
          active: S.Optional(S.Boolean())
        })
      )
    });

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<{
      name: string;
      count: number;
      enabled: boolean;
      role: "admin" | "user";
      tags: string[];
      metadata?: {
        retries: number;
        active?: boolean;
      };
    }>();
  });

  it("infers undefined for optional non-object schemas", () => {
    const ignoredSchema = S.Optional(S.Array(S.Boolean()));

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<boolean[] | undefined>();
  });

  it("infers null for nullable schemas and validation results", () => {
    const nullableString = S.String({ nullable: true });
    const ignoredNullableArray = S.Array(S.Number(), { nullable: true });
    const ignoredNullableObject = S.Object({
      name: S.String({ nullable: true })
    });
    const result = validate(nullableString, null);

    expectTypeOf<Static<typeof nullableString>>().toEqualTypeOf<string | null>();
    expectTypeOf<Static<typeof ignoredNullableArray>>().toEqualTypeOf<number[] | null>();
    expectTypeOf<Static<typeof ignoredNullableObject>>().toEqualTypeOf<{ name: string | null }>();

    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<string | null>();
    }
  });

  it("infers static types for discriminated oneOf schemas", () => {
    const ignoredSchema = S.OneOf({
      discriminator: "kind",
      branches: {
        text: S.Object({
          value: S.String(),
          preview: S.Optional(S.Boolean())
        }),
        count: S.Object({
          value: S.Number()
        })
      }
    });

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<
      | {
          kind: "text";
          value: string;
          preview?: boolean;
        }
      | {
          kind: "count";
          value: number;
        }
    >();
  });

  it("infers static types for union, record, and json schemas", () => {
    const ignoredUnionSchema = S.Union([
      S.Object({
        email: S.String(),
        name: S.Optional(S.String())
      }),
      S.Object({
        phone: S.String(),
        extension: S.Optional(S.Number())
      })
    ]);
    const ignoredRecordSchema = S.Record(S.Array(S.Boolean()));
    const ignoredJsonSchema = S.Json();

    expectTypeOf<Static<typeof ignoredUnionSchema>>().toEqualTypeOf<
      | {
          email: string;
          name?: string;
        }
      | {
          phone: string;
          extension?: number;
        }
    >();
    expectTypeOf<Static<typeof ignoredRecordSchema>>().toEqualTypeOf<Record<string, boolean[]>>();
    expectTypeOf<Static<typeof ignoredJsonSchema>>().toEqualTypeOf<
      | string
      | number
      | boolean
      | null
      | { [key: string]: Static<typeof ignoredJsonSchema> }
      | Array<Static<typeof ignoredJsonSchema>>
    >();
  });

  it("infers static types for optional object properties without leaking undefined into present values", () => {
    const ignoredSchema = S.Object({
      requiredValue: S.String(),
      optionalValue: S.Optional(S.Number())
    });

    expectTypeOf<Static<typeof ignoredSchema>>().toEqualTypeOf<{
      requiredValue: string;
      optionalValue?: number;
    }>();
  });

  it("serializes primitive schemas to JSON Schema", () => {
    expect(toJsonSchema(S.String({ description: "Name", default: "guest" }))).toEqual({
      type: "string",
      description: "Name",
      default: "guest"
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Number({ description: "Count", default: 3 }))).toEqual({
      type: "number",
      description: "Count",
      default: 3
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Boolean({ description: "Enabled", default: false }))).toEqual({
      type: "boolean",
      description: "Enabled",
      default: false
    } satisfies JsonSchema);
  });

  it("serializes nullable schemas and preserves non-validating JSON Schema metadata", () => {
    expect(
      toJsonSchema(
        S.String({
          nullable: true,
          minLength: 3,
          maxLength: 40,
          pattern: "^[a-z]+$",
          format: "date-time"
        })
      )
    ).toEqual({
      type: "string",
      nullable: true,
      minLength: 3,
      maxLength: 40,
      pattern: "^[a-z]+$",
      format: "date-time"
    } satisfies JsonSchema);

    expect(
      toJsonSchema(
        S.Number({
          jsonType: "integer",
          minimum: 1,
          maximum: 100
        })
      )
    ).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 100
    } satisfies JsonSchema);

    expect(
      toJsonSchema(
        S.Array(S.String(), {
          minItems: 1,
          maxItems: 4
        })
      )
    ).toEqual({
      type: "array",
      items: {
        type: "string"
      },
      minItems: 1,
      maxItems: 4
    } satisfies JsonSchema);
  });

  it("serializes integer-flavored number schemas as JSON Schema integers", () => {
    expect(
      toJsonSchema(S.Number({ description: "Count", default: 3, jsonType: "integer" }))
    ).toEqual({
      type: "integer",
      description: "Count",
      default: 3
    } satisfies JsonSchema);
  });

  it("serializes enum schemas with enum values and defaults", () => {
    expect(
      toJsonSchema(
        S.Enum(["admin", "user", "guest"] as const, {
          description: "Role",
          default: "user"
        })
      )
    ).toEqual({
      type: "string",
      enum: ["admin", "user", "guest"],
      description: "Role",
      default: "user"
    } satisfies JsonSchema);
  });

  it("serializes integer-flavored enums as JSON Schema integers", () => {
    expect(
      toJsonSchema(
        S.Enum([1, 2, 3] as const, {
          description: "Status code",
          default: 2,
          jsonType: "integer"
        })
      )
    ).toEqual({
      type: "integer",
      enum: [1, 2, 3],
      description: "Status code",
      default: 2
    } satisfies JsonSchema);
  });

  it("serializes nullable enums with null in the advertised enum list", () => {
    expect(
      toJsonSchema(
        S.Enum(["off", "auto", "forced"] as const, {
          nullable: true
        })
      )
    ).toEqual({
      type: "string",
      enum: ["off", "auto", "forced", null],
      nullable: true
    } satisfies JsonSchema);
  });

  it("serializes numeric, boolean, and mixed enums to JSON Schema", () => {
    expect(toJsonSchema(S.Enum([1, 2, 3] as const))).toEqual({
      type: "number",
      enum: [1, 2, 3]
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Enum([true, false] as const))).toEqual({
      type: "boolean",
      enum: [true, false]
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Enum(["enabled", false] as const))).toEqual({
      enum: ["enabled", false]
    } satisfies JsonSchema);
  });

  it("serializes array schemas with nested item schemas", () => {
    expect(
      toJsonSchema(
        S.Array(S.Number({ description: "Single value" }), {
          description: "Values",
          default: [1, 2, 3]
        })
      )
    ).toEqual({
      type: "array",
      items: {
        type: "number",
        description: "Single value"
      },
      description: "Values",
      default: [1, 2, 3]
    } satisfies JsonSchema);
  });

  it("serializes nested object schemas and tracks required keys from optional wrappers", () => {
    const schema = S.Object({
      name: S.String({ description: "Display name" }),
      enabled: S.Optional(S.Boolean({ default: true })),
      nested: S.Object({
        port: S.Number({ default: 5432 }),
        secure: S.Optional(S.Boolean())
      })
    });

    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name"
        },
        enabled: {
          type: "boolean",
          default: true
        },
        nested: {
          type: "object",
          properties: {
            port: {
              type: "number",
              default: 5432
            },
            secure: {
              type: "boolean"
            }
          },
          required: ["port"],
          additionalProperties: false
        }
      },
      required: ["name", "nested"],
      additionalProperties: false
    } satisfies JsonSchema);
  });

  it("serializes empty object schemas with an empty required array", () => {
    expect(toJsonSchema(S.Object({}))).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    } satisfies JsonSchema);
  });

  it("serializes object schemas with additionalProperties metadata", () => {
    expect(
      toJsonSchema(
        S.Object(
          {
            name: S.String()
          },
          { additionalProperties: false }
        )
      )
    ).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string"
        }
      },
      required: ["name"],
      additionalProperties: false
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Object({ name: S.String() }, { additionalProperties: true }))).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string"
        }
      },
      required: ["name"],
      additionalProperties: true
    } satisfies JsonSchema);
  });

  it("serializes object JSON Schema contracts that reject runtime-rejected extra properties", () => {
    expect(
      toJsonSchemaDocument(
        S.Object({
          user: S.Object({
            name: S.String()
          })
        })
      )
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        user: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string"
            }
          },
          required: ["name"]
        }
      },
      required: ["user"]
    } satisfies JsonSchema);
  });

  it("serializes oneOf schemas by injecting discriminator literals into each branch", () => {
    expect(
      toJsonSchema(
        S.OneOf({
          discriminator: "kind",
          branches: {
            text: S.Object({
              value: S.String()
            }),
            count: S.Object({
              value: S.Number(),
              preview: S.Optional(S.Boolean())
            })
          }
        })
      )
    ).toEqual({
      oneOf: [
        {
          type: "object",
          properties: {
            value: {
              type: "string"
            },
            kind: {
              type: "string",
              enum: ["text"]
            }
          },
          required: ["value", "kind"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            value: {
              type: "number"
            },
            preview: {
              type: "boolean"
            },
            kind: {
              type: "string",
              enum: ["count"]
            }
          },
          required: ["value", "kind"],
          additionalProperties: false
        }
      ]
    } satisfies JsonSchema);
  });

  it("serializes union, record, and json schemas", () => {
    expect(
      toJsonSchema(
        S.Union([
          S.Object({
            email: S.String()
          }),
          S.Object({
            phone: S.String(),
            extension: S.Optional(S.Number({ jsonType: "integer" }))
          })
        ])
      )
    ).toEqual({
      oneOf: [
        {
          type: "object",
          properties: {
            email: {
              type: "string"
            }
          },
          required: ["email"],
          additionalProperties: false
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
          required: ["phone"],
          additionalProperties: false
        }
      ]
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Record(S.Number({ jsonType: "integer" })))).toEqual({
      type: "object",
      additionalProperties: {
        type: "integer"
      }
    } satisfies JsonSchema);

    expect(toJsonSchema(S.Json())).toEqual({} satisfies JsonSchema);
  });

  it("treats double-wrapped optional object properties as optional", () => {
    const schema = S.Object({
      maybeName: S.Optional(S.Optional(S.String({ default: "guest" })))
    });

    expectTypeOf<Static<typeof schema>>().toEqualTypeOf<{
      maybeName?: string | undefined;
    }>();

    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        maybeName: {
          type: "string",
          default: "guest"
        }
      },
      required: [],
      additionalProperties: false
    } satisfies JsonSchema);
  });

  it("serializes top-level optional schemas as the underlying JSON Schema", () => {
    expect(toJsonSchema(S.Optional(S.String({ default: "value" })))).toEqual({
      type: "string",
      default: "value"
    } satisfies JsonSchema);
  });

  it("stores labels on an enum schema and exposes them for lookup", () => {
    const schema = S.Enum(["admin", "user"] as const, {
      labels: { admin: "Administrator", user: "Regular User" }
    });

    expect(schema.labels).toEqual({ admin: "Administrator", user: "Regular User" });
    expect(schema.labels?.["admin"]).toBe("Administrator");
    expect(schema.labels?.["guest"]).toBeUndefined();
  });

  it("rejects empty enums at runtime for JavaScript callers", () => {
    expect(() => S.Enum([] as unknown as [string])).toThrow(
      "Enum schema requires at least one value"
    );
  });

  it("rejects duplicate enum values at runtime", () => {
    expect(() => S.Enum(["admin", "admin"] as const)).toThrow("Enum schema values must be unique");
  });

  it("rejects invalid constraint metadata and non-finite schema values", () => {
    expect(() => S.String({ minLength: -1 })).toThrow("minLength");
    expect(() => S.String({ pattern: "[" })).toThrow("pattern");
    expect(() => S.Array(S.String(), { maxItems: -1 })).toThrow("maxItems");
    expect(() => S.Number({ minimum: Number.POSITIVE_INFINITY })).toThrow("minimum");
    expect(() => S.Number({ default: Number.NaN })).toThrow("default");
  });

  it("rejects impossible bound ordering at schema construction time", () => {
    expect(() => S.String({ minLength: 5, maxLength: 3 })).toThrow(
      "minLength must be less than or equal to maxLength"
    );
    expect(() => S.Number({ minimum: 10, maximum: 3 })).toThrow(
      "minimum must be less than or equal to maximum"
    );
    expect(() => S.Array(S.String(), { minItems: 3, maxItems: 1 })).toThrow(
      "minItems must be less than or equal to maxItems"
    );
  });

  it("rejects defaults that do not satisfy their schemas", () => {
    expect(() => S.String({ default: 123 as unknown as string })).toThrow(
      "default must satisfy schema"
    );
    expect(() => S.Boolean({ default: "yes" as unknown as boolean })).toThrow(
      "default must satisfy schema"
    );
    expect(() =>
      S.Enum(["fast", "safe"] as const, { default: "turbo" as unknown as "fast" })
    ).toThrow("default must satisfy schema");
    expect(() => S.Array(S.Number(), { default: ["one"] as unknown as number[] })).toThrow(
      "default must satisfy schema"
    );
  });

  it("rejects invalid integer enum members and non-finite enum values", () => {
    expect(() => S.Enum([Number.POSITIVE_INFINITY] as const)).toThrow("finite");
    expect(() => S.Enum([1.5, 2] as const, { jsonType: "integer" })).toThrow("integer");
  });

  it("rejects oneOf schemas without branches at runtime", () => {
    expect(() =>
      S.OneOf({
        discriminator: "kind",
        branches: {}
      })
    ).toThrow("OneOf schema requires at least one branch");
  });

  it("rejects oneOf branches that declare the discriminator field", () => {
    expect(() =>
      S.OneOf({
        discriminator: "kind",
        branches: {
          text: S.Object({
            kind: S.Enum(["custom"] as const),
            value: S.String()
          })
        }
      })
    ).toThrow('OneOf branch "text" must not declare discriminator field "kind".');
  });

  it("rejects union schemas without branches at runtime", () => {
    expect(() => S.Union([])).toThrow("Union schema requires at least one branch");
  });

  it("rejects union schemas with duplicate required-key fingerprints", () => {
    expect(() =>
      S.Union([
        S.Object({
          email: S.String(),
          verified: S.Optional(S.Boolean())
        }),
        S.Object({
          email: S.Number()
        })
      ])
    ).toThrow(
      'Union branches [0, 1] share required-key fingerprint "email". Each branch must require a distinct set of keys.'
    );
  });
});
